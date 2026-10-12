import { RedisClient } from 'bun';
import type { Party, PartySnapshot } from './party';

/** Where parties are kept so a server restart doesn't end them. Writes never throw. */
export interface PartyStore {
	/** Queues a write of the party's current state; writes in the same tick are batched. */
	save(party: Party): void;
	remove(partyId: string): void;
	loadAll(): Promise<PartySnapshot[]>;
}

/** No REDIS_URL: parties live only as long as the process. */
export const memoryOnly: PartyStore = {
	save() {},
	remove() {},
	loadAll: async () => []
};

const PREFIX = 'bye0:party:';
const LOAD_TIMEOUT_MS = 5_000;

/**
 * Keeps one JSON snapshot per party in Redis, expiring `ttlMs` after its last write, so a
 * party nobody touches disappears from Redis the same way it does from memory.
 */
export function redisStore(url: string, ttlMs: number): PartyStore {
	const redis = new RedisClient(url);
	const dirty = new Map<string, Party>();
	let failing = false;

	const report = (what: string) => (err: unknown) => {
		// Once per outage, not once per write.
		if (!failing) console.error(`party store: ${what} failed, parties won't survive a restart until it's back:`, err);
		failing = true;
	};
	const ok = () => {
		if (failing) console.log('party store: back');
		failing = false;
	};

	function flush() {
		for (const party of dirty.values())
			redis.send('SET', [PREFIX + party.id, JSON.stringify(party.snapshot()), 'PX', String(ttlMs)]).then(ok, report('save'));
		dirty.clear();
	}

	return {
		save(party) {
			if (dirty.size === 0) setTimeout(flush, 0);
			dirty.set(party.id, party);
		},
		remove(partyId) {
			// A batched save still waiting would bring it back.
			dirty.delete(partyId);
			redis.del(PREFIX + partyId).then(ok, report('remove'));
		},
		async loadAll() {
			const load = async () => {
				const keys: string[] = [];
				let cursor = '0';
				do {
					const [next, batch] = (await redis.send('SCAN', [cursor, 'MATCH', `${PREFIX}*`, 'COUNT', '100'])) as [string, string[]];
					keys.push(...batch);
					cursor = next;
				} while (cursor !== '0');
				if (!keys.length) return [];
				const values = (await redis.send('MGET', keys)) as (string | null)[];
				return values.flatMap((json) => {
					const snapshot = json ? (JSON.parse(json) as PartySnapshot) : null;
					return snapshot?.v === 1 ? [snapshot] : [];
				});
			};
			const timeout = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`no answer in ${LOAD_TIMEOUT_MS} ms`)), LOAD_TIMEOUT_MS)
			);
			return Promise.race([load(), timeout]);
		}
	};
}
