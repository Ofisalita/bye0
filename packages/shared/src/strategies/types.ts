import type { GuestId, PartyContext, QueueItem } from '../types';

/** Decides what plays next. */
export interface OrderingStrategy {
	id: string;
	order(queue: QueueItem[], ctx: PartyContext): QueueItem[];
}

export type Intent =
	/** Skip the song that is playing. */
	| { type: 'skip'; by: GuestId }
	/** Remove a queued song. */
	| { type: 'remove'; by: GuestId; item: QueueItem }
	/** Move a queued song to the front. */
	| { type: 'bump'; by: GuestId; item: QueueItem };

export type DenyReason = 'not-allowed' | 'already-voted' | 'nothing-playing';

export type Resolution =
	| { kind: 'apply' }
	| { kind: 'deny'; reason: DenyReason }
	/** The intent counts as a vote that hasn't reached the threshold yet. */
	| { kind: 'vote'; have: number; needed: number };

/** Decides who can skip/remove/bump and how disputes resolve. */
export interface GovernanceMode {
	id: string;
	handle(intent: Intent, ctx: PartyContext): Resolution;
}

/** Layered on top of any governance mode. */
export interface Modifier {
	id: string;
	wrap(next: GovernanceMode['handle']): GovernanceMode['handle'];
}
