import type { GuestId, PartySettings, PartyState, Role, SearchResult } from './types';

/** Messages a browser sends over the WebSocket. */
export type ClientMessage =
	// `token` is the device's secret identity (localStorage); it never leaves this channel.
	| { t: 'create'; nickname: string; token: string; settings?: Partial<PartySettings> }
	| { t: 'join'; code: string; nickname: string; token: string }
	/** `player`: this tab was the Player before its connection dropped; it takes the role back if it's free. */
	| { t: 'resume'; partyId: string; token: string; player?: boolean }
	| { t: 'start' }
	| { t: 'add'; input: string }
	/** Find songs by name; the results come back to this connection only. */
	| { t: 'search'; q: string }
	| { t: 'skip' }
	| { t: 'remove'; itemId: string }
	| { t: 'bump'; itemId: string }
	/** Two queued songs trade places. */
	| { t: 'swap'; itemId: string; otherId: string }
	/** Give a queued song your upvote, or take it back. */
	| { t: 'upvote'; itemId: string }
	/** Choose which candidate plays: the adder while `confirmBy` is open, the host any time. */
	| { t: 'pick'; itemId: string; candidateIndex: number }
	| { t: 'settings'; patch: Partial<PartySettings> }
	| { t: 'role'; guestId: GuestId; role: Exclude<Role, 'host'> }
	| { t: 'kick'; guestId: GuestId }
	/** Let a guest in from the lobby. Turning one away is a kick. */
	| { t: 'approve'; guestId: GuestId }
	| { t: 'end' }
	// Player view only
	| { t: 'player.claim' }
	| { t: 'player.heartbeat'; itemId: string; positionMs: number; paused: boolean }
	| { t: 'player.ended'; itemId: string }
	| { t: 'player.error'; itemId: string; code: number };

export type ErrorCode =
	| 'bad-request'
	| 'bad-code'
	| 'party-gone'
	| 'banned'
	| 'rate-limited'
	| 'not-allowed'
	| 'already-voted'
	| 'nothing-playing'
	| 'unresolvable'
	| 'collection'
	| 'matching-unavailable'
	| 'too-long'
	| 'queue-limit'
	| 'cooldown'
	| 'locked'
	| 'other-network';

export type ServerMessage =
	| { t: 'welcome'; you: GuestId; state: PartyState }
	| { t: 'state'; state: PartyState }
	| { t: 'error'; code: ErrorCode }
	| { t: 'search.results'; q: string; results: SearchResult[] }
	| { t: 'ended' };

/** Join-code alphabet: 20 symbols with the look-alikes (B/8, I/1, O/0, Q, S/5, Z/2) left out. */
export const CODE_ALPHABET = 'ACDEFGHJKLMNPRTUVWXY';
export const CODE_LENGTH = 4;
export const NICKNAME_MAX = 24;
/** How long the adder has to pick when the match is uncertain, and how many candidates they see. */
export const CONFIRM_MS = 10_000;
export const CONFIRM_CHOICES = 3;
