import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, type Guest, type PartyContext, type QueueItem } from '../types';
import { GOVERNANCES, ORDERINGS } from './index';

const item = (id: string, addedBy: string, addedAt: number): QueueItem => ({
	id,
	addedBy,
	addedAt,
	title: id,
	artists: [],
	durationMs: 0,
	candidates: [],
	candidateIndex: 0
});
const guest = (id: string, role: Guest['role'] = 'guest', connected = true): Guest => ({
	id,
	nickname: id,
	role,
	connected,
	joinedAt: 0
});
const ctx = (guests: Guest[], skipVotes: string[] = [], skipThreshold = 0.5): PartyContext => ({
	guests,
	settings: { ...DEFAULT_SETTINGS, skipThreshold },
	nowPlaying: { item: item('np', 'a', 0), positionMs: 0, positionAt: 0, paused: false, skipVotes },
	lastPlayedAt: {},
	now: 0
});
const ids = (q: QueueItem[]) => q.map((i) => i.id);

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

	test('democracy: skip needs the threshold of connected guests', () => {
		const g = GOVERNANCES.democracy!;
		// 4 connected × 0.5 = 2 votes
		expect(g.handle({ type: 'skip', by: 'a' }, ctx(guests))).toEqual({ kind: 'vote', have: 1, needed: 2 });
		expect(g.handle({ type: 'skip', by: 'b' }, ctx(guests, ['a'])).kind).toBe('apply');
		expect(g.handle({ type: 'skip', by: 'a' }, ctx(guests, ['a']))).toEqual({ kind: 'deny', reason: 'already-voted' });
	});

	test('democracy: host overrides, guests cannot bump', () => {
		const g = GOVERNANCES.democracy!;
		expect(g.handle({ type: 'skip', by: 'h' }, ctx(guests, [], 1)).kind).toBe('apply');
		expect(g.handle({ type: 'bump', by: 'a', item: item('x', 'a', 0) }, ctx(guests)).kind).toBe('deny');
	});
});
