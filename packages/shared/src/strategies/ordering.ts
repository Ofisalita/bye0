import type { QueueItem } from '../types';
import type { OrderingStrategy } from './types';

/** Add order, as rearranged by any swaps. */
const bySlot = (a: QueueItem, b: QueueItem) => a.slot - b.slot || a.id.localeCompare(b.id);

export const fifo: OrderingStrategy = {
	id: 'fifo',
	swaps: 'any',
	order: (queue) => [...queue].sort(bySlot)
};

const upvotes = (item: QueueItem) => Object.keys(item.upvotes).length;

/** Most upvotes first; ties in add order. */
export const voteRanked: OrderingStrategy = {
	id: 'vote-ranked',
	usesUpvotes: true,
	order: (queue) => [...queue].sort((a, b) => upvotes(b) - upvotes(a) || bySlot(a, b))
};

/** A vote is worth half as much every time this long passes. */
export const HOT_HALF_LIFE_MS = 10 * 60_000;

/**
 * Like vote-ranked, but a vote counts for less the older it gets, so what the room wants now
 * beats what it wanted an hour ago. Every vote fades at the same rate, which means time
 * passing never reorders the queue by itself: only a vote does.
 */
export const hot: OrderingStrategy = {
	id: 'hot',
	usesUpvotes: true,
	order(queue, ctx) {
		const heat = new Map(
			queue.map((item) => [
				item,
				Object.values(item.upvotes).reduce((sum, at) => sum + 0.5 ** ((ctx.now - at) / HOT_HALF_LIFE_MS), 0)
			])
		);
		return [...queue].sort((a, b) => heat.get(b)! - heat.get(a)! || bySlot(a, b));
	}
};

/** FNV-1a. Any even spread of ids would do. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/**
 * Random, but the same on every call and on every device: a song's place comes from its id.
 * So the queue doesn't reshuffle with each broadcast, and a new song can land anywhere in it.
 */
export const shuffle: OrderingStrategy = {
	id: 'shuffle',
	order: (queue) => [...queue].sort((a, b) => hash(a.id) - hash(b.id) || bySlot(a, b))
};

/**
 * Everyone's 1st song, then everyone's 2nd, … Within a round, whoever has waited
 * longest since their last song goes first.
 */
export const roundRobin: OrderingStrategy = {
	id: 'round-robin',
	// Turns belong to guests, so a song can only take the place of another from the same guest.
	swaps: 'own',
	order(queue, ctx) {
		const seen = new Map<string, number>();
		const lastPlayed = (item: QueueItem) => ctx.lastPlayedAt[item.addedBy] ?? -Infinity;
		return [...queue]
			.sort(bySlot)
			.map((item) => {
				const round = seen.get(item.addedBy) ?? 0;
				seen.set(item.addedBy, round + 1);
				return { item, round };
			})
			.sort(
				(a, b) =>
					a.round - b.round ||
					// `||` also covers -Infinity - -Infinity = NaN (neither has played yet)
					lastPlayed(a.item) - lastPlayed(b.item) ||
					bySlot(a.item, b.item)
			)
			.map(({ item }) => item);
	}
};

/** Whether the ordering lets these two songs trade places. Songs bumped to the front stay put. */
export function canSwap(ordering: OrderingStrategy, a: QueueItem, b: QueueItem): boolean {
	if (a.id === b.id || a.bumpedAt !== undefined || b.bumpedAt !== undefined) return false;
	return ordering.swaps === 'any' || (ordering.swaps === 'own' && a.addedBy === b.addedBy);
}
