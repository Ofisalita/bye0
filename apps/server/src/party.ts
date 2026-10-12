import {
	DEFAULT_SETTINGS,
	GOVERNANCES,
	NICKNAME_MAX,
	ORDERINGS,
	type Candidate,
	type ErrorCode,
	type Guest,
	type GuestId,
	type Intent,
	type PartyContext,
	type PartySettings,
	type PartyState,
	type QueueItem,
	type NowPlaying,
	type Role
} from '@bye0/shared';

export interface ResolvedTrack {
	title: string;
	artists: string[];
	durationMs: number;
	candidates: Candidate[];
}

type Result = ErrorCode | null;

/**
 * Authoritative state of one party. No I/O in here: the caller passes `now`,
 * and broadcasts `state()` after any call that returns without an error.
 */
export class Party {
	readonly id = crypto.randomUUID();
	code = '';
	previousCode: string | null = null;
	codeRotatedAt = 0;
	lastActivity: number;

	started = false;
	settings: PartySettings;
	nowPlaying: NowPlaying | null = null;

	private guests = new Map<GuestId, Guest>();
	private tokens = new Map<string, GuestId>();
	private banned = new Set<string>();
	private queue: QueueItem[] = [];
	/** connection id → guest; one guest may have several tabs open. */
	private conns = new Map<string, GuestId>();
	private playerConn: string | null = null;
	private lastPlayedAt: Record<GuestId, number> = {};

	constructor(now: number, settings: Partial<PartySettings> = {}) {
		this.lastActivity = now;
		this.settings = { ...DEFAULT_SETTINGS };
		this.patchSettings(settings);
	}

	// --- views ---

	private context(now: number): PartyContext {
		return {
			guests: [...this.guests.values()],
			settings: this.settings,
			nowPlaying: this.nowPlaying,
			lastPlayedAt: this.lastPlayedAt,
			now
		};
	}

	private orderedQueue(now: number): QueueItem[] {
		const ordering = ORDERINGS[this.settings.ordering]!;
		const bumped = this.queue
			.filter((i) => i.bumpedAt !== undefined)
			.sort((a, b) => b.bumpedAt! - a.bumpedAt!);
		const rest = this.queue.filter((i) => i.bumpedAt === undefined);
		return [...bumped, ...ordering.order(rest, this.context(now))];
	}

	state(now: number): PartyState {
		return {
			id: this.id,
			code: this.code,
			started: this.started,
			guests: [...this.guests.values()],
			queue: this.orderedQueue(now),
			nowPlaying: this.nowPlaying,
			settings: this.settings,
			playerId: this.playerConn ? (this.conns.get(this.playerConn) ?? null) : null,
			serverNow: now
		};
	}

	guestByToken(token: string): Guest | undefined {
		const id = this.tokens.get(token);
		return id ? this.guests.get(id) : undefined;
	}

	// --- membership ---

	join(token: string, nickname: string, now: number, role: Role = 'guest'): Guest | ErrorCode {
		if (this.banned.has(token)) return 'banned';
		const name = nickname.trim().slice(0, NICKNAME_MAX);
		if (!name || !token) return 'bad-request';
		const existing = this.guestByToken(token);
		if (existing) {
			existing.nickname = name;
			return existing;
		}
		const guest: Guest = { id: crypto.randomUUID(), nickname: name, role, connected: false, joinedAt: now };
		this.guests.set(guest.id, guest);
		this.tokens.set(token, guest.id);
		return guest;
	}

	connect(connId: string, guestId: GuestId, now: number): void {
		this.conns.set(connId, guestId);
		this.guests.get(guestId)!.connected = true;
		this.lastActivity = now;
	}

	/** Returns true if anything visible changed. */
	disconnect(connId: string): boolean {
		const guestId = this.conns.get(connId);
		if (!guestId) return false;
		this.conns.delete(connId);
		if (this.playerConn === connId) this.playerConn = null;
		const guest = this.guests.get(guestId);
		if (guest) guest.connected = [...this.conns.values()].includes(guestId);
		return true;
	}

	/** Connection ids that belonged to the kicked guest, for the caller to close. */
	kick(by: GuestId, guestId: GuestId): string[] | ErrorCode {
		const target = this.guests.get(guestId);
		if (!this.is(by, 'host') || !target || target.role === 'host') return 'not-allowed';
		for (const [token, id] of this.tokens) {
			if (id === guestId) {
				this.banned.add(token);
				this.tokens.delete(token);
			}
		}
		this.guests.delete(guestId);
		this.queue = this.queue.filter((i) => i.addedBy !== guestId);
		const conns = [...this.conns].filter(([, id]) => id === guestId).map(([c]) => c);
		for (const c of conns) this.disconnect(c);
		return conns;
	}

	setRole(by: GuestId, guestId: GuestId, role: Role): Result {
		const target = this.guests.get(guestId);
		if (!this.is(by, 'host') || !target || target.role === 'host' || role === 'host') return 'not-allowed';
		target.role = role;
		return null;
	}

	patchSettings(patch: Partial<PartySettings>, by?: GuestId): Result {
		if (by !== undefined && !this.is(by, 'host')) return 'not-allowed';
		const next = { ...this.settings, ...patch };
		const posOrNull = (n: number | null) => n === null || (Number.isFinite(n) && n > 0);
		if (
			!ORDERINGS[next.ordering] ||
			!GOVERNANCES[next.governance] ||
			typeof next.skipThreshold !== 'number' ||
			!(next.skipThreshold > 0 && next.skipThreshold <= 1) ||
			typeof next.showAttribution !== 'boolean' ||
			!posOrNull(next.maxDurationMs) ||
			!posOrNull(next.maxQueuedPerGuest)
		)
			return 'bad-request';
		// Copy field by field so unknown keys in a client's patch are dropped.
		this.settings = {
			ordering: next.ordering,
			governance: next.governance,
			skipThreshold: next.skipThreshold,
			showAttribution: next.showAttribution,
			maxDurationMs: next.maxDurationMs,
			maxQueuedPerGuest: next.maxQueuedPerGuest
		};
		return null;
	}

	// --- queue ---

	start(by: GuestId, now: number): Result {
		if (!this.is(by, 'host')) return 'not-allowed';
		this.started = true;
		if (!this.nowPlaying) this.advance(now);
		return null;
	}

	/** Cheap check to run before spending a matching-service call. */
	canAdd(by: GuestId): Result {
		const max = this.settings.maxQueuedPerGuest;
		if (max !== null && this.queue.filter((i) => i.addedBy === by).length >= max) return 'queue-limit';
		return null;
	}

	add(by: GuestId, track: ResolvedTrack, now: number): Result {
		if (!this.guests.has(by)) return 'not-allowed';
		const limited = this.canAdd(by);
		if (limited) return limited;
		if (!track.candidates.length) return 'unresolvable';
		const max = this.settings.maxDurationMs;
		if (max !== null && track.durationMs > max) return 'too-long';
		this.queue.push({
			id: crypto.randomUUID(),
			addedBy: by,
			addedAt: now,
			title: track.title,
			artists: track.artists,
			durationMs: track.durationMs,
			candidates: track.candidates,
			candidateIndex: 0
		});
		this.lastActivity = now;
		if (this.started && !this.nowPlaying) this.advance(now);
		return null;
	}

	skip(by: GuestId, now: number): Result {
		const np = this.nowPlaying;
		if (!np) return 'nothing-playing';
		const res = this.resolve({ type: 'skip', by }, now);
		if (res.kind === 'deny') return res.reason;
		if (res.kind === 'vote' && res.have < res.needed) np.skipVotes.push(by);
		else this.advance(now);
		return null;
	}

	remove(by: GuestId, itemId: string, now: number): Result {
		const item = this.queue.find((i) => i.id === itemId);
		if (!item) return 'bad-request';
		const res = this.resolve({ type: 'remove', by, item }, now);
		if (res.kind !== 'apply') return 'not-allowed';
		this.queue = this.queue.filter((i) => i !== item);
		return null;
	}

	bump(by: GuestId, itemId: string, now: number): Result {
		const item = this.queue.find((i) => i.id === itemId);
		if (!item) return 'bad-request';
		const res = this.resolve({ type: 'bump', by, item }, now);
		if (res.kind !== 'apply') return 'not-allowed';
		item.bumpedAt = now;
		return null;
	}

	// --- player ---

	claimPlayer(connId: string): Result {
		const guestId = this.conns.get(connId);
		if (!guestId || this.is(guestId, 'guest')) return 'not-allowed';
		this.playerConn = connId;
		return null;
	}

	/** Returns true when the change is worth broadcasting. */
	heartbeat(connId: string, itemId: string, positionMs: number, paused: boolean, now: number): boolean {
		const np = this.currentFor(connId, itemId);
		if (!np || !Number.isFinite(positionMs) || positionMs < 0) return false;
		const changed = np.paused !== paused;
		np.positionMs = positionMs;
		np.positionAt = now;
		np.paused = paused;
		this.lastActivity = now;
		return changed;
	}

	ended(connId: string, itemId: string, now: number): boolean {
		if (!this.currentFor(connId, itemId)) return false;
		this.advance(now);
		return true;
	}

	/** YouTube `onError`: try the next candidate, or move on when there is none left. */
	playerError(connId: string, itemId: string, now: number): boolean {
		const np = this.currentFor(connId, itemId);
		if (!np) return false;
		if (np.item.candidateIndex + 1 < np.item.candidates.length) {
			np.item.candidateIndex++;
			np.positionMs = 0;
			np.positionAt = now;
		} else this.advance(now);
		return true;
	}

	// --- internals ---

	is(id: GuestId, role: Role): boolean {
		return this.guests.get(id)?.role === role;
	}

	private resolve(intent: Intent, now: number) {
		return GOVERNANCES[this.settings.governance]!.handle(intent, this.context(now));
	}

	private currentFor(connId: string, itemId: string): NowPlaying | null {
		if (this.playerConn !== connId || this.nowPlaying?.item.id !== itemId) return null;
		return this.nowPlaying;
	}

	private advance(now: number): void {
		const next = this.orderedQueue(now)[0];
		this.queue = this.queue.filter((i) => i !== next);
		if (next) this.lastPlayedAt[next.addedBy] = now;
		this.nowPlaying = next
			? { item: next, positionMs: 0, positionAt: now, paused: false, skipVotes: [] }
			: null;
	}
}
