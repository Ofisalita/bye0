import type { ClientMessage, ErrorCode, ServerMessage } from '@bye0/shared';
import type { ServerWebSocket } from 'bun';
import { collectionExpander, matchingService, youtubeOnly } from './matching';
import { Party } from './party';
import { PARTY_TTL_MS, Registry } from './registry';
import { memoryOnly, redisStore } from './store';

const PORT = Number(process.env.PORT ?? 3001);
const MATCHING_URL = process.env.MATCHING_URL;
/** ISO 3166-1 alpha-2 code the matching service localizes searches to, e.g. CL. */
const MATCHING_COUNTRY = process.env.MATCHING_COUNTRY?.toUpperCase() || undefined;
if (MATCHING_COUNTRY && !/^[A-Z]{2}$/.test(MATCHING_COUNTRY))
	throw new Error(`MATCHING_COUNTRY must be a two-letter country code like CL, got "${MATCHING_COUNTRY}"`);
const MAX_INPUT_LENGTH = 500;
/** Album/playlist songs are looked up once they're this close to playing (nidol D9). */
const LOOKAHEAD = 3;
/** Optional: with it, parties survive a restart or redeploy of this server. */
const REDIS_URL = process.env.REDIS_URL;

interface Conn {
	id: string;
	ip: string;
	partyId?: string;
	guestId?: string;
}
type Socket = ServerWebSocket<Conn>;

const registry = new Registry();
const store = REDIS_URL ? redisStore(REDIS_URL, PARTY_TTL_MS) : memoryOnly;
try {
	const snapshots = await store.loadAll();
	for (const snapshot of snapshots) registry.restore(Party.restore(snapshot));
	if (snapshots.length) console.log(`restored ${snapshots.length} part${snapshots.length === 1 ? 'y' : 'ies'}`);
} catch (err) {
	console.error('could not load saved parties, starting without them:', err);
}
const resolveTrack = MATCHING_URL ? matchingService(MATCHING_URL, { country: MATCHING_COUNTRY }) : youtubeOnly;
const expandCollection = MATCHING_URL ? collectionExpander(MATCHING_URL) : null;
const sockets = new Map<string, Socket>();
/** Ids of album/playlist songs being looked up right now. */
const lookingUp = new Set<string>();

const topic = (party: Party) => `party:${party.id}`;
const send = (ws: Socket, msg: ServerMessage) => ws.send(JSON.stringify(msg));
const fail = (ws: Socket, code: ErrorCode) => send(ws, { t: 'error', code });
/**
 * Sends everyone the new state, and saves it. Every change goes through here.
 * Never throws: it also runs from socket-close and timer callbacks, where an error would exit the process.
 */
function broadcast(party: Party) {
	store.save(party);
	try {
		server.publish(topic(party), JSON.stringify({ t: 'state', state: party.state(Date.now()) } satisfies ServerMessage));
		lookAhead(party);
	} catch (err) {
		console.error(`broadcast failed for party ${party.id}:`, err);
	}
}

/** Starts looking up album/playlist songs that are about to play; each result is broadcast. */
function lookAhead(party: Party) {
	for (const item of party.stubsAhead(LOOKAHEAD, Date.now())) {
		if (lookingUp.has(item.id)) continue;
		lookingUp.add(item.id);
		resolveTrack(item.source!, { preferAudio: party.settings.preferAudio })
			.catch((err): ErrorCode => {
				console.error('collection song lookup failed:', err);
				return 'unresolvable';
			})
			.then((track) => {
				lookingUp.delete(item.id);
				if (typeof track === 'string') console.warn(`dropping "${item.title}" from an album/playlist: ${track}`);
				if (registry.get(party.id) === party && party.fillStub(item.id, track, Date.now())) broadcast(party);
			});
	}
}

function endParty(party: Party) {
	server.publish(topic(party), JSON.stringify({ t: 'ended' } satisfies ServerMessage));
	registry.end(party);
	store.remove(party.id);
}

/** `asPlayer`: a Player view coming back after its connection dropped takes the role back, if it's free. */
function enter(ws: Socket, party: Party, guestId: string, asPlayer = false) {
	ws.data.partyId = party.id;
	ws.data.guestId = guestId;
	party.connect(ws.data.id, guestId, Date.now(), ws.data.ip);
	// Before the welcome, so the player never sees itself lose the role.
	if (asPlayer) party.claimPlayer(ws.data.id, false);
	ws.subscribe(topic(party));
	send(ws, { t: 'welcome', you: guestId, state: party.state(Date.now()) });
	broadcast(party);
}

function handleEntry(ws: Socket, msg: ClientMessage) {
	const now = Date.now();
	switch (msg.t) {
		case 'create': {
			const party = registry.create(now, msg.settings);
			const host = party.join(msg.token, msg.nickname, now, 'host');
			if (typeof host === 'string') {
				registry.end(party);
				return fail(ws, host);
			}
			return enter(ws, party, host.id);
		}
		case 'join': {
			const party = registry.join(String(msg.code), ws.data.ip, now);
			if (typeof party === 'string') return fail(ws, party);
			const guest = party.join(msg.token, msg.nickname, now, 'guest', ws.data.ip);
			if (typeof guest === 'string') return fail(ws, guest);
			return enter(ws, party, guest.id);
		}
		case 'resume': {
			const party = registry.get(msg.partyId);
			const guest = party?.guestByToken(msg.token);
			if (!party || !guest) return fail(ws, 'party-gone');
			return enter(ws, party, guest.id, msg.player === true);
		}
		default:
			return fail(ws, 'bad-request');
	}
}

async function handle(ws: Socket, msg: ClientMessage) {
	const party = ws.data.partyId ? registry.get(ws.data.partyId) : undefined;
	const me = ws.data.guestId;
	if (!party || !me) return handleEntry(ws, msg);
	// Guests in the lobby can only wait to be let in (or turned away).
	if (party.isPending(me)) return fail(ws, 'not-allowed');

	const now = Date.now();
	/** Broadcasts on success, tells only the sender on failure. */
	const done = (error: ErrorCode | null) => (error ? fail(ws, error) : broadcast(party));

	switch (msg.t) {
		case 'start':
			return done(party.start(me, now));
		case 'add': {
			const limited = party.canAdd(me, now);
			if (limited) return fail(ws, limited);
			if (typeof msg.input !== 'string' || !msg.input.trim() || msg.input.length > MAX_INPUT_LENGTH)
				return fail(ws, 'bad-request');
			const track = await resolveTrack(msg.input, { preferAudio: party.settings.preferAudio }).catch((err): ErrorCode => {
				console.error('resolve failed:', err);
				return 'unresolvable';
			});
			if (track === 'collection') {
				if (!party.settings.allowCollections || !expandCollection) return fail(ws, 'collection');
				const tracks = await expandCollection(msg.input).catch((err): ErrorCode => {
					console.error('expand failed:', err);
					return 'matching-unavailable';
				});
				if (typeof tracks === 'string') return fail(ws, tracks);
				return done(party.addCollection(me, tracks, Date.now()));
			}
			if (typeof track === 'string') return fail(ws, track);
			return done(party.add(me, track, Date.now()));
		}
		case 'skip':
			return done(party.skip(me, now));
		case 'remove':
			return done(party.remove(me, msg.itemId, now));
		case 'bump':
			return done(party.bump(me, msg.itemId, now));
		case 'upvote':
			return done(party.upvote(me, msg.itemId, now));
		case 'pick':
			return done(party.pick(me, msg.itemId, msg.candidateIndex, now));
		case 'settings':
			return done(party.patchSettings(msg.patch ?? {}, me));
		case 'approve':
			return done(party.approve(me, msg.guestId));
		case 'role':
			return done(party.setRole(me, msg.guestId, msg.role));
		case 'kick': {
			const kicked = party.kick(me, msg.guestId);
			if (typeof kicked === 'string') return fail(ws, kicked);
			for (const id of kicked) {
				const s = sockets.get(id);
				if (s) {
					fail(s, 'banned');
					s.close();
				}
			}
			return broadcast(party);
		}
		case 'end':
			if (!party.is(me, 'host')) return fail(ws, 'not-allowed');
			return endParty(party);
		case 'player.claim':
			return done(party.claimPlayer(ws.data.id));
		case 'player.heartbeat':
			if (party.heartbeat(ws.data.id, msg.itemId, msg.positionMs, msg.paused, now)) broadcast(party);
			// Saved even when nothing visible changed, so a restart resumes close to the right spot.
			else store.save(party);
			return;
		case 'player.ended':
			if (party.ended(ws.data.id, msg.itemId, now)) broadcast(party);
			return;
		case 'player.error':
			console.warn(`player error ${msg.code} on item ${msg.itemId}`);
			if (party.playerError(ws.data.id, msg.itemId, now)) broadcast(party);
			return;
		default:
			return fail(ws, 'bad-request');
	}
}

const server = Bun.serve<Conn>({
	port: PORT,
	fetch(req, server) {
		const { pathname } = new URL(req.url);
		if (pathname === '/healthz') return new Response('ok');
		if (pathname === '/ws') {
			// Behind a reverse proxy the socket address is the proxy's.
			const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || server.requestIP(req)?.address || '';
			if (server.upgrade(req, { data: { id: crypto.randomUUID(), ip } })) return;
			return new Response('expected a WebSocket', { status: 426 });
		}
		return new Response('not found', { status: 404 });
	},
	websocket: {
		open(ws) {
			sockets.set(ws.data.id, ws);
		},
		message(ws, raw) {
			let msg: ClientMessage;
			try {
				msg = JSON.parse(String(raw));
				if (typeof msg?.t !== 'string') throw new Error('no type');
			} catch {
				fail(ws, 'bad-request');
				return;
			}
			handle(ws, msg).catch((err) => {
				console.error('handler failed:', err);
				fail(ws, 'bad-request');
			});
		},
		close(ws) {
			sockets.delete(ws.data.id);
			const party = ws.data.partyId ? registry.get(ws.data.partyId) : undefined;
			if (party?.disconnect(ws.data.id)) broadcast(party);
		}
	}
});

setInterval(() => {
	const { rotated, expired } = registry.tick(Date.now());
	rotated.forEach(broadcast);
	for (const party of expired) {
		server.publish(topic(party), JSON.stringify({ t: 'ended' } satisfies ServerMessage));
		store.remove(party.id);
	}
}, 5_000);

console.log(
	`bye0 room server on :${server.port} (${MATCHING_URL ? `matching: ${MATCHING_URL}, country: ${MATCHING_COUNTRY ?? 'none'}` : 'no MATCHING_URL: YouTube links only'}; ${REDIS_URL ? 'parties saved to Redis' : 'no REDIS_URL: parties end on restart'})`
);
