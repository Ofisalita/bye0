import type { GuestId, PartySettings, PartyState, Role } from './types';

/** Messages a browser sends over the WebSocket. */
export type ClientMessage =
	// `token` is the device's secret identity (localStorage); it never leaves this channel.
	| { t: 'create'; nickname: string; token: string; settings?: Partial<PartySettings> }
	| { t: 'join'; code: string; nickname: string; token: string }
	| { t: 'resume'; partyId: string; token: string }
	| { t: 'start' }
	| { t: 'add'; input: string }
	| { t: 'skip' }
	| { t: 'remove'; itemId: string }
	| { t: 'bump'; itemId: string }
	| { t: 'settings'; patch: Partial<PartySettings> }
	| { t: 'role'; guestId: GuestId; role: Exclude<Role, 'host'> }
	| { t: 'kick'; guestId: GuestId }
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
	| 'too-long'
	| 'queue-limit';

export type ServerMessage =
	| { t: 'welcome'; you: GuestId; state: PartyState }
	| { t: 'state'; state: PartyState }
	| { t: 'error'; code: ErrorCode }
	| { t: 'ended' };

/** Join-code alphabet: 20 symbols with the look-alikes (B/8, I/1, O/0, Q, S/5, Z/2) left out. */
export const CODE_ALPHABET = 'ACDEFGHJKLMNPRTUVWXY';
export const CODE_LENGTH = 4;
export const NICKNAME_MAX = 24;
