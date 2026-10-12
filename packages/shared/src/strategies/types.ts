import type { GuestId, PartyContext, QueueItem } from '../types';

/** Decides what plays next. */
export interface OrderingStrategy {
	id: string;
	/** Upvotes move songs, so guests get the button. */
	usesUpvotes?: boolean;
	/**
	 * Which queued songs may trade places: two from the same guest (`own`), or any two (`any`).
	 * Unset when the order isn't anyone's to arrange. Who may ask is up to the governance mode.
	 */
	swaps?: 'own' | 'any';
	order(queue: QueueItem[], ctx: PartyContext): QueueItem[];
}

export type Intent =
	/** Skip the song that is playing. */
	| { type: 'skip'; by: GuestId }
	/** Remove a queued song. */
	| { type: 'remove'; by: GuestId; item: QueueItem }
	/** Move a queued song to the front. */
	| { type: 'bump'; by: GuestId; item: QueueItem }
	/** Two queued songs trade places. */
	| { type: 'swap'; by: GuestId; item: QueueItem; other: QueueItem };

export type DenyReason = 'not-allowed' | 'already-voted' | 'nothing-playing';

export type Resolution =
	| { kind: 'apply' }
	| { kind: 'deny'; reason: DenyReason }
	/** The intent counts as a vote (included in `have`); it carries once `have >= needed`. */
	| { kind: 'vote'; have: number; needed: number };

/** Decides who can skip/remove/bump/swap and how disputes resolve. */
export interface GovernanceMode {
	id: string;
	/** Skips are put to a vote, so `settings.skipThreshold` matters. */
	votesToSkip?: boolean;
	handle(intent: Intent, ctx: PartyContext): Resolution;
}

/** Layered on top of any governance mode. */
export interface Modifier {
	id: string;
	wrap(next: GovernanceMode['handle']): GovernanceMode['handle'];
}
