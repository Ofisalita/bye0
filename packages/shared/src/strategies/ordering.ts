import type { QueueItem } from '../types';
import type { OrderingStrategy } from './types';

const byAddedAt = (a: QueueItem, b: QueueItem) => a.addedAt - b.addedAt || a.id.localeCompare(b.id);

export const fifo: OrderingStrategy = {
	id: 'fifo',
	order: (queue) => [...queue].sort(byAddedAt)
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
