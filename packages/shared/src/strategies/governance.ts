import type { GuestId, PartyContext } from '../types';
import type { GovernanceMode, Intent, Resolution } from './types';

const APPLY: Resolution = { kind: 'apply' };
const NOT_ALLOWED: Resolution = { kind: 'deny', reason: 'not-allowed' };

const isHost = (id: GuestId, ctx: PartyContext) =>
	ctx.guests.some((g) => g.id === id && g.role === 'host');

/** Taking back your own song, or two of your own songs trading places: nobody else is affected. */
const onlyTheirOwn = (intent: Intent) =>
	(intent.type === 'remove' && intent.item.addedBy === intent.by) ||
	(intent.type === 'swap' && intent.item.addedBy === intent.by && intent.other.addedBy === intent.by);

/** Votes needed to skip: a fraction of the guests currently connected, at least 1. */
export function skipVotesNeeded(ctx: PartyContext): number {
	const active = ctx.guests.filter((g) => g.connected).length;
	return Math.max(1, Math.ceil(active * ctx.settings.skipThreshold));
}

/** Host only. Guests may still take back or rearrange their own songs. */
export const dictatorship: GovernanceMode = {
	id: 'dictatorship',
	handle(intent, ctx) {
		if (isHost(intent.by, ctx)) return APPLY;
		return onlyTheirOwn(intent) ? APPLY : NOT_ALLOWED;
	}
};

/** Skips go to a vote at a threshold of active guests; everyone manages only their own songs. */
const byVote: GovernanceMode['handle'] = (intent, ctx) => {
	switch (intent.type) {
		case 'skip': {
			const np = ctx.nowPlaying;
			if (!np) return { kind: 'deny', reason: 'nothing-playing' };
			if (np.skipVotes.includes(intent.by)) return { kind: 'deny', reason: 'already-voted' };
			return { kind: 'vote', have: np.skipVotes.length + 1, needed: skipVotesNeeded(ctx) };
		}
		case 'remove':
		case 'swap':
			return onlyTheirOwn(intent) ? APPLY : NOT_ALLOWED;
		case 'bump':
			return NOT_ALLOWED;
	}
};

/** No host tyranny: the host's skip is one vote like anyone else's, and nobody bumps. */
export const fullDemocracy: GovernanceMode = {
	id: 'full-democracy',
	votesToSkip: true,
	handle: byVote
};

/** Guests vote, but the host can skip, remove, bump and swap without asking. */
export const presidentialDemocracy: GovernanceMode = {
	id: 'presidential-democracy',
	votesToSkip: true,
	handle: (intent, ctx) => (isHost(intent.by, ctx) ? APPLY : byVote(intent, ctx))
};

/** No rules: anyone skips, removes, bumps or swaps any song, right away. */
export const anarchy: GovernanceMode = {
	id: 'anarchy',
	handle: () => APPLY
};
