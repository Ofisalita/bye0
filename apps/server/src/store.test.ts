import { expect, test } from 'bun:test';
import { Party } from './party';
import { redisStore } from './store';

// Needs a Redis to talk to; CI starts one. Locally: REDIS_URL=redis://localhost:6379 bun test
const url = process.env.REDIS_URL;

test.skipIf(!url)('redis: saves batch per party, expire, and come back; removed parties stay gone', async () => {
	const store = redisStore(url!, 60_000);
	const a = new Party(0);
	const b = new Party(0);
	a.code = 'ACDE';
	store.save(a);
	a.code = 'FGHJ'; // same tick: one write with the latest state
	store.save(a);
	store.save(b);
	store.remove(b.id); // a save still waiting must not bring it back
	await Bun.sleep(100);

	const mine = (await store.loadAll()).filter((s) => s.id === a.id || s.id === b.id);
	expect(mine.map((s) => [s.id, s.code])).toEqual([[a.id, 'FGHJ']]);

	store.remove(a.id);
	await Bun.sleep(100);
	expect((await store.loadAll()).some((s) => s.id === a.id)).toBe(false);
});
