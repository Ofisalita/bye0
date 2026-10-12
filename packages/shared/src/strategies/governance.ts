import type { GuestId, PartyContext } from '../types';
import type { GovernanceMode, Resolution } from './types';

const APPLY: Resolution = { kind: 'apply' };
const NOT_ALLOWED: Resolution = { kind: 'deny', reason: 'not-allowed' };

const isHost = (id: GuestId, ctx: PartyContext) =>
	ctx.guests.some((g) => g.id === id && g.role === 'host');

/** Votes needed to skip: a fraction of the guests currently connected, at least 1. */
export function skipVotesNeeded(ctx: PartyContext): number {
	const active = ctx.guests.filter((g) => g.connected).length;
	return Math.max(1, Math.ceil(active * ctx.settings.skipThreshold));
}

/** Host only. Guests may still take back their own songs. */
export const dictatorship: GovernanceMode = {
	id: 'dictatorship',
	handle(intent, ctx) {
		if (isHost(intent.by, ctx)) return APPLY;
		if (intent.type === 'remove' && intent.item.addedBy === intent.by) return APPLY;
		return NOT_ALLOWED;
	}
};

/** Vote-skip at a threshold of active guests. The host keeps an override. */
export const democracy: GovernanceMode = {
	id: 'democracy',
	handle(intent, ctx) {
		if (isHost(intent.by, ctx)) return APPLY;
		switch (intent.type) {
			case 'skip': {
				const np = ctx.nowPlaying;
				if (!np) return { kind: 'deny', reason: 'nothing-playing' };
				if (np.skipVotes.includes(intent.by)) return { kind: 'deny', reason: 'already-voted' };
				const have = np.skipVotes.length + 1;
				const needed = skipVotesNeeded(ctx);
				return have >= needed ? APPLY : { kind: 'vote', have, needed };
			}
			case 'remove':
				return intent.item.addedBy === intent.by ? APPLY : NOT_ALLOWED;
			case 'bump':
				return NOT_ALLOWED;
		}
	}
};
