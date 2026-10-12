import type { ClientMessage, ErrorCode, Guest, PartySettings, PartyState, ServerMessage } from '@bye0/shared';

const TOKEN_KEY = 'bye0.token';
const PARTY_KEY = 'bye0.party';
const NICKNAME_KEY = 'bye0.nickname';
const RETRY_MS = 1_000;
const ERROR_SHOWN_MS = 4_000;

/** This device's secret identity. Clearing storage makes it a new guest. */
function deviceToken(): string {
	let token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		token = crypto.randomUUID();
		localStorage.setItem(TOKEN_KEY, token);
	}
	return token;
}

export const savedNickname = () => localStorage.getItem(NICKNAME_KEY) ?? '';
export const savedPartyId = () => localStorage.getItem(PARTY_KEY);

type Entry =
	| { t: 'create'; nickname: string; settings?: Partial<PartySettings> }
	| { t: 'join'; code: string; nickname: string }
	| { t: 'resume'; partyId: string };

/** One WebSocket to the room server, plus the party state it mirrors. */
export class PartyClient {
	state = $state<PartyState | null>(null);
	you = $state<string | null>(null);
	error = $state<ErrorCode | null>(null);
	status = $state<'idle' | 'connecting' | 'open' | 'ended'>('idle');
	/** Why this device is out of the party, when it wasn't simply ended. Unlike `error`, it stays. */
	endReason = $state<ErrorCode | null>(null);
	/** Add to Date.now() to get the server's clock. */
	clockOffset = 0;

	me = $derived<Guest | undefined>(this.state?.guests.find((g) => g.id === this.you));
	isHost = $derived(this.me?.role === 'host');

	private ws: WebSocket | null = null;
	private entry: Entry | null = null;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private errorTimer: ReturnType<typeof setTimeout> | undefined;

	enter(entry: Entry): void {
		if ('nickname' in entry) localStorage.setItem(NICKNAME_KEY, entry.nickname);
		this.entry = entry;
		this.endReason = null;
		this.open();
	}

	/** Reconnects to the party this device was last in. False if there is none. */
	resume(): boolean {
		const partyId = savedPartyId();
		if (!partyId) return false;
		this.enter({ t: 'resume', partyId });
		return true;
	}

	send(msg: ClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
	}

	/** Drops the connection without leaving the party. */
	close(): void {
		clearTimeout(this.retry);
		this.entry = null;
		this.ws?.close();
		this.ws = null;
		this.status = 'idle';
	}

	private open(): void {
		clearTimeout(this.retry);
		this.ws?.close();
		this.status = 'connecting';
		const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
		this.ws = ws;
		ws.onopen = () => {
			if (this.entry) ws.send(JSON.stringify({ ...this.entry, token: deviceToken() }));
		};
		ws.onmessage = (e) => this.receive(JSON.parse(e.data));
		ws.onclose = () => {
			if (this.ws !== ws) return;
			this.ws = null;
			// Only retry once we're in a party; a failed join shouldn't loop.
			if (this.entry?.t === 'resume' && this.status !== 'ended') {
				this.status = 'connecting';
				this.retry = setTimeout(() => this.open(), RETRY_MS);
			} else if (this.status !== 'ended') this.status = 'idle';
		};
	}

	private receive(msg: ServerMessage): void {
		switch (msg.t) {
			case 'welcome':
				this.you = msg.you;
				this.status = 'open';
				localStorage.setItem(PARTY_KEY, msg.state.id);
				this.entry = { t: 'resume', partyId: msg.state.id };
				this.setState(msg.state);
				break;
			case 'state':
				this.setState(msg.state);
				break;
			case 'ended':
				this.leave();
				break;
			case 'error':
				if (msg.code === 'party-gone' || msg.code === 'banned') {
					this.leave();
					this.endReason = msg.code;
				}
				this.error = msg.code;
				clearTimeout(this.errorTimer);
				this.errorTimer = setTimeout(() => (this.error = null), ERROR_SHOWN_MS);
				break;
		}
	}

	private setState(state: PartyState): void {
		this.clockOffset = state.serverNow - Date.now();
		this.state = state;
	}

	private leave(): void {
		localStorage.removeItem(PARTY_KEY);
		this.entry = null;
		this.state = null;
		this.status = 'ended';
		this.ws?.close();
	}
}

/** Shared by the landing and party pages. The Player view opens its own. */
export const party = new PartyClient();
