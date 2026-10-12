import { democracy, dictatorship } from './governance';
import { fifo, roundRobin } from './ordering';
import type { GovernanceMode, OrderingStrategy } from './types';

export * from './types';
export { skipVotesNeeded } from './governance';

// Add new modules here; everything else looks them up by id.
export const ORDERINGS: Record<string, OrderingStrategy> = Object.fromEntries(
	[roundRobin, fifo].map((s) => [s.id, s])
);
export const GOVERNANCES: Record<string, GovernanceMode> = Object.fromEntries(
	[democracy, dictatorship].map((g) => [g.id, g])
);
