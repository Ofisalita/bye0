import type { QueueItem } from '../types';
import type { OrderingStrategy } from './types';

const byAddedAt = (a: QueueItem, b: QueueItem) => a.addedAt - b.addedAt || a.id.localeCompare(b.id);

export const fifo: OrderingStrategy = {
	id: 'fifo',
	order: (queue) => [...queue].sort(byAddedAt)
};

const upvotes = (item: QueueItem) => Object.keys(item.upvotes).length;

/** Most upvotes first; ties in add order. */
export const voteRanked: OrderingStrategy = {
	id: 'vote-ranked',
	usesUpvotes: true,
	order: (queue) => [...queue].sort((a, b) => upvotes(b) - upvotes(a) || byAddedAt(a, b))
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
		return [...queue].sort((a, b) => heat.get(b)! - heat.get(a)! || byAddedAt(a, b));
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
	order: (queue) => [...queue].sort((a, b) => hash(a.id) - hash(b.id) || byAddedAt(a, b))
};

/**
 * Everyone's 1st song, then everyone's 2nd, … Within a round, whoever has waited
 * longest since their last song goes first.
 */
export const roundRobin: OrderingStrategy = {
	id: 'round-robin',
	order(queue, ctx) {
		const seen = new Map<string, number>();
		const lastPlayed = (item: QueueItem) => ctx.lastPlayedAt[item.addedBy] ?? -Infinity;
		return [...queue]
			.sort(byAddedAt)
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
					byAddedAt(a.item, b.item)
			)
			.map(({ item }) => item);
	}
};
