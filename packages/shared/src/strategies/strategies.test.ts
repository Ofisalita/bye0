import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, type Guest, type PartyContext, type QueueItem } from '../types';
import { canSwap, GOVERNANCES, HOT_HALF_LIFE_MS, ORDERINGS } from './index';

const item = (id: string, addedBy: string, addedAt: number, upvotes: QueueItem['upvotes'] = {}): QueueItem => ({
	id,
	addedBy,
	addedAt,
	slot: addedAt,
	title: id,
	artists: [],
	durationMs: 0,
	candidates: [],
	candidateIndex: 0,
	upvotes
});
const guest = (id: string, role: Guest['role'] = 'guest', connected = true): Guest => ({
	id,
	nickname: id,
	role,
	connected,
	joinedAt: 0,
	lastAddedAt: null
});
const ctx = (guests: Guest[], skipVotes: string[] = [], skipThreshold = 0.5): PartyContext => ({
	guests,
	settings: { ...DEFAULT_SETTINGS, skipThreshold },
	nowPlaying: { item: item('np', 'a', 0), positionMs: 0, positionAt: 0, paused: false, skipVotes },
	lastPlayedAt: {},
	now: 0
});
const ids = (q: QueueItem[]) => q.map((i) => i.id);

test('lookups ignore names every object inherits', () => {
	for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
		expect(ORDERINGS[id]).toBeUndefined();
		expect(GOVERNANCES[id]).toBeUndefined();
	}
	expect(Object.keys(ORDERINGS)).toEqual(['round-robin', 'fifo', 'vote-ranked', 'hot', 'shuffle']);
});

describe('ordering', () => {
	const queue = [item('a1', 'a', 1), item('a2', 'a', 2), item('a3', 'a', 3), item('b1', 'b', 4), item('c1', 'c', 5), item('b2', 'b', 6)];

	test('fifo keeps add order', () => {
		expect(ids(ORDERINGS.fifo!.order([...queue].reverse(), ctx([])))).toEqual(['a1', 'a2', 'a3', 'b1', 'c1', 'b2']);
	});

	test('round-robin interleaves guests', () => {
		expect(ids(ORDERINGS['round-robin']!.order(queue, ctx([])))).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
	});

	test('round-robin: whoever just played waits for the others', () => {
		const c = { ...ctx([]), lastPlayedAt: { a: 10, b: 5 } };
		expect(ids(ORDERINGS['round-robin']!.order(queue, c))).toEqual(['c1', 'b1', 'a1', 'b2', 'a2', 'a3']);
	});

	test('vote-ranked: most upvotes first, ties and the unvoted in add order', () => {
		const voted = [item('a1', 'a', 1), item('b1', 'b', 2, { x: 9 }), item('c1', 'c', 3, { x: 5, y: 6 }), item('d1', 'd', 4, { y: 7 })];
		expect(ids(ORDERINGS['vote-ranked']!.order(voted, ctx([])))).toEqual(['c1', 'b1', 'd1', 'a1']);
	});

	test('hot: old votes fade, and time alone never reorders', () => {
		const h = HOT_HALF_LIFE_MS;
		// At 3h: old has two votes that are three half-lives old (2 × 1/8), fresh has one new vote.
		const voted = [item('old', 'a', 0, { x: 0, y: 0 }), item('fresh', 'b', 1, { x: 3 * h }), item('none', 'c', 2), item('none2', 'd', 3)];
		const at = (now: number) => ids(ORDERINGS.hot!.order(voted, { ...ctx([]), now }));
		expect(at(3 * h)).toEqual(['fresh', 'old', 'none', 'none2']);
		expect(at(30 * h)).toEqual(at(3 * h));
		expect(ids(ORDERINGS['vote-ranked']!.order(voted, ctx([])))).toEqual(['old', 'fresh', 'none', 'none2']);
	});

	test('swaps: any two under fifo, a guest\'s own under round-robin, none elsewhere or once bumped', () => {
		const [a1, a2, b1] = [item('a1', 'a', 1), item('a2', 'a', 2), item('b1', 'b', 3)];
		const allowed = (id: string) => [canSwap(ORDERINGS[id]!, a1!, a2!), canSwap(ORDERINGS[id]!, a1!, b1!)];
		expect(allowed('fifo')).toEqual([true, true]);
		expect(allowed('round-robin')).toEqual([true, false]);
		for (const id of ['vote-ranked', 'hot', 'shuffle']) expect(allowed(id)).toEqual([false, false]);
		expect(canSwap(ORDERINGS.fifo!, a1!, a1!)).toBe(false);
		expect(canSwap(ORDERINGS.fifo!, a1!, { ...a2!, bumpedAt: 5 })).toBe(false);
	});

	test('swapped slots move songs under fifo and round-robin', () => {
		const swapped = queue.map((i) => ({ ...i }));
		const [a1, a3] = [swapped[0]!, swapped[2]!];
		[a1.slot, a3.slot] = [a3.slot, a1.slot];
		expect(ids(ORDERINGS.fifo!.order(swapped, ctx([])))).toEqual(['a3', 'a2', 'a1', 'b1', 'c1', 'b2']);
		expect(ids(ORDERINGS['round-robin']!.order(swapped, ctx([])))).toEqual(['a3', 'b1', 'c1', 'a2', 'b2', 'a1']);
	});

	test('shuffle: out of add order, yet the same every time and unmoved by new songs', () => {
		const shuffled = ids(ORDERINGS.shuffle!.order(queue, ctx([])));
		expect([...shuffled].sort()).toEqual(ids(queue).sort());
		expect(shuffled).not.toEqual(ids(queue));
		expect(ids(ORDERINGS.shuffle!.order([...queue].reverse(), ctx([])))).toEqual(shuffled);
		const more = ids(ORDERINGS.shuffle!.order([...queue, item('d1', 'd', 7), item('d2', 'd', 8)], ctx([])));
		expect(more.filter((id) => !id.startsWith('d'))).toEqual(shuffled);
	});
});

describe('governance', () => {
	const guests = [guest('h', 'host'), guest('a'), guest('b'), guest('c'), guest('gone', 'guest', false)];

	test('dictatorship: only the host skips; guests can remove their own song', () => {
		const g = GOVERNANCES.dictatorship!;
		expect(g.handle({ type: 'skip', by: 'h' }, ctx(guests)).kind).toBe('apply');
		expect(g.handle({ type: 'skip', by: 'a' }, ctx(guests)).kind).toBe('deny');
		expect(g.handle({ type: 'remove', by: 'a', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('apply');
		expect(g.handle({ type: 'remove', by: 'b', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('deny');
	});

	test('both democracies: a guest skip is a vote against the threshold of connected guests', () => {
		for (const id of ['full-democracy', 'presidential-democracy']) {
			const g = GOVERNANCES[id]!;
			// 4 connected × 0.5 = 2 votes
			expect(g.handle({ type: 'skip', by: 'a' }, ctx(guests))).toEqual({ kind: 'vote', have: 1, needed: 2 });
			expect(g.handle({ type: 'skip', by: 'b' }, ctx(guests, ['a']))).toEqual({ kind: 'vote', have: 2, needed: 2 });
			expect(g.handle({ type: 'skip', by: 'a' }, ctx(guests, ['a']))).toEqual({ kind: 'deny', reason: 'already-voted' });
			expect(g.handle({ type: 'remove', by: 'a', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('apply');
			expect(g.handle({ type: 'remove', by: 'b', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('deny');
			expect(g.handle({ type: 'bump', by: 'a', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('deny');
		}
	});

	test('full democracy: the host is one more voter', () => {
		const g = GOVERNANCES['full-democracy']!;
		expect(g.handle({ type: 'skip', by: 'h' }, ctx(guests, [], 1))).toEqual({ kind: 'vote', have: 1, needed: 4 });
		expect(g.handle({ type: 'skip', by: 'h' }, ctx(guests, ['h'], 1))).toEqual({ kind: 'deny', reason: 'already-voted' });
		expect(g.handle({ type: 'remove', by: 'h', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('deny');
		expect(g.handle({ type: 'remove', by: 'h', item: item('x', 'h', 0) }, ctx(guests)).kind).toBe('apply');
		expect(g.handle({ type: 'bump', by: 'h', item: item('x', 'h', 0) }, ctx(guests)).kind).toBe('deny');
	});

	test('swap: everyone rearranges their own songs; other people\'s only where the mode says so', () => {
		const mine = { type: 'swap', item: item('x', 'a', 0), other: item('y', 'a', 1) } as const;
		const mixed = { type: 'swap', item: item('x', 'a', 0), other: item('y', 'b', 1) } as const;
		const answers = (id: string, by: string) =>
			[mine, mixed].map((intent) => GOVERNANCES[id]!.handle({ ...intent, by }, ctx(guests)).kind);
		for (const id of ['dictatorship', 'full-democracy', 'presidential-democracy']) expect(answers(id, 'a')).toEqual(['apply', 'deny']);
		expect(answers('full-democracy', 'h')).toEqual(['deny', 'deny']);
		expect(answers('dictatorship', 'h')).toEqual(['apply', 'apply']);
		expect(answers('presidential-democracy', 'h')).toEqual(['apply', 'apply']);
		expect(answers('anarchy', 'b')).toEqual(['apply', 'apply']);
	});

	test('anarchy: anyone does anything, no vote', () => {
		const g = GOVERNANCES.anarchy!;
		expect(g.handle({ type: 'skip', by: 'a' }, ctx(guests, [], 1)).kind).toBe('apply');
		expect(g.handle({ type: 'remove', by: 'a', item: item('x', 'b', 0) }, ctx(guests)).kind).toBe('apply');
		expect(g.handle({ type: 'bump', by: 'a', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('apply');
	});

	test('presidential democracy: the host overrides', () => {
		const g = GOVERNANCES['presidential-democracy']!;
		expect(g.handle({ type: 'skip', by: 'h' }, ctx(guests, [], 1)).kind).toBe('apply');
		expect(g.handle({ type: 'remove', by: 'h', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('apply');
		expect(g.handle({ type: 'bump', by: 'h', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('apply');
	});
});
