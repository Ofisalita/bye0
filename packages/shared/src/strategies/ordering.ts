import type { QueueItem } from '../types';
import type { OrderingStrategy } from './types';

const byAddedAt = (a: QueueItem, b: QueueItem) => a.addedAt - b.addedAt || a.id.localeCompare(b.id);

export const fifo: OrderingStrategy = {
	id: 'fifo',
	order: (queue) => [...queue].sort(byAddedAt)
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
