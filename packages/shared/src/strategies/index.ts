import { anarchy, dictatorship, fullDemocracy, presidentialDemocracy } from './governance';
import { fifo, hot, roundRobin, shuffle, voteRanked } from './ordering';
import type { GovernanceMode, OrderingStrategy } from './types';

export * from './types';
export { skipVotesNeeded } from './governance';
export { canSwap, HOT_HALF_LIFE_MS } from './ordering';

/**
 * Lookup table with no prototype, so ids a client sends like "constructor" or "toString"
 * find nothing instead of an inherited Object method.
 */
const byId = <T extends { id: string }>(modules: T[]): Record<string, T> =>
	Object.assign(Object.create(null), Object.fromEntries(modules.map((m) => [m.id, m])));

// Add new modules here; everything else looks them up by id.
export const ORDERINGS = byId<OrderingStrategy>([roundRobin, fifo, voteRanked, hot, shuffle]);
export const GOVERNANCES = byId<GovernanceMode>([fullDemocracy, presidentialDemocracy, dictatorship, anarchy]);
