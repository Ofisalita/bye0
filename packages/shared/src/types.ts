export type GuestId = string;
export type Role = 'host' | 'cohost' | 'guest';

export interface Guest {
	id: GuestId;
	nickname: string;
	role: Role;
	connected: boolean;
	joinedAt: number;
	/** When one of this guest's songs last made it into the queue; drives the add cooldown. */
	lastAddedAt: number | null;
}

/** A playable YouTube video, as returned by the matching service. */
export interface Candidate {
	videoId: string;
	title: string;
	channel: string;
	/** 0 when unknown. */
	durationMs: number;
	kind?: string;
	confidence?: number;
	thumbnailUrl?: string;
}

export interface QueueItem {
	id: string;
	addedBy: GuestId;
	addedAt: number;
	title: string;
	artists: string[];
	durationMs: number;
	/** Ranked; the player falls through them on embed errors. */
	candidates: Candidate[];
	candidateIndex: number;
	/** Set when someone with the right to do so moved it to the front. */
	bumpedAt?: number;
	/**
	 * Set when the matching service wasn't sure of the match: until then (server time) whoever
	 * added it can pick one of the top candidates. Cleared once someone picks.
	 */
	confirmBy?: number;
}

export interface NowPlaying {
	item: QueueItem;
	/** Last position reported by the player, and the server time it was reported at. */
	positionMs: number;
	positionAt: number;
	paused: boolean;
	skipVotes: GuestId[];
}

export interface PartySettings {
	ordering: string;
	governance: string;
	/** Democracy: fraction of connected guests needed to skip (0–1]. */
	skipThreshold: number;
	showAttribution: boolean;
	maxDurationMs: number | null;
	maxQueuedPerGuest: number | null;
	/** Minimum time between two songs from the same guest. */
	addCooldownMs: number | null;
	/** For pasted YouTube music videos, play the official audio upload instead (nidol D7). */
	preferAudio: boolean;
}

/** What strategies get to look at. */
export interface PartyContext {
	guests: Guest[];
	settings: PartySettings;
	nowPlaying: NowPlaying | null;
	/** When each guest last had one of their songs start playing. */
	lastPlayedAt: Record<GuestId, number>;
	now: number;
}

/** What every client receives. */
export interface PartyState {
	id: string;
	code: string;
	started: boolean;
	guests: Guest[];
	/** Already in play order. */
	queue: QueueItem[];
	nowPlaying: NowPlaying | null;
	settings: PartySettings;
	/** Guest whose device runs the Player view, if any. */
	playerId: GuestId | null;
	serverNow: number;
}

export const DEFAULT_SETTINGS: PartySettings = {
	ordering: 'round-robin',
	governance: 'full-democracy',
	skipThreshold: 0.5,
	showAttribution: true,
	maxDurationMs: 10 * 60_000,
	maxQueuedPerGuest: null,
	addCooldownMs: null,
	preferAudio: false
};

export interface Preset {
	id: string;
	settings: Partial<PartySettings>;
}

// Only presets whose strategies exist are listed; SPEC §4 has the full set.
export const PRESETS: Preset[] = [
	{ id: 'chill-dinner', settings: { ordering: 'fifo', governance: 'dictatorship' } },
	{ id: 'house-party', settings: { ordering: 'round-robin', governance: 'full-democracy' } },
	{ id: 'chaos', settings: { ordering: 'shuffle', governance: 'anarchy' } }
];
