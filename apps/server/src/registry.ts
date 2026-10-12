import { CODE_ALPHABET, CODE_LENGTH, type PartySettings } from '@bye0/shared';
import { Party } from './party';

export const CODE_ROTATE_MS = 5 * 60_000;
/** How long the previous code keeps working after a rotation. */
export const CODE_GRACE_MS = 60_000;
/** Safety net: a party nobody touched for this long is deleted. */
export const PARTY_TTL_MS = 6 * 60 * 60_000;
/**
 * Wrong join codes one IP may try per window. Right codes don't count: a whole party
 * joins from the same Wi-Fi, so it shares one public IP.
 */
export const WRONG_CODES_PER_WINDOW = 10;
export const WRONG_CODE_WINDOW_MS = 60_000;

function randomCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
	// 256 % 20 != 0 gives a slight bias; irrelevant for a code that lives five minutes.
	return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** All live parties, in memory. */
export class Registry {
	private parties = new Map<string, Party>();
	private codes = new Map<string, string>();
	/** Wrong codes per IP in its current window. */
	private wrongCodes = new Map<string, { count: number; since: number }>();

	create(now: number, settings?: Partial<PartySettings>): Party {
		const party = new Party(now, settings);
		this.parties.set(party.id, party);
		this.assignCode(party, now);
		return party;
	}

	get(id: string): Party | undefined {
		return this.parties.get(id);
	}

	byCode(code: string, now: number): Party | undefined {
		const party = this.parties.get(this.codes.get(code.toUpperCase()) ?? '');
		if (!party) return undefined;
		if (code.toUpperCase() !== party.code && now - party.codeRotatedAt > CODE_GRACE_MS) return undefined;
		return party;
	}

	/** A guest at `ip` typed `code`. Only wrong codes count toward that IP's limit. */
	join(code: string, ip: string, now: number): Party | 'bad-code' | 'rate-limited' {
		let strikes = this.wrongCodes.get(ip);
		if (strikes && now - strikes.since >= WRONG_CODE_WINDOW_MS) strikes = undefined;
		if (strikes && strikes.count >= WRONG_CODES_PER_WINDOW) return 'rate-limited';
		const party = this.byCode(code, now);
		if (party) return party;
		this.wrongCodes.set(ip, { count: (strikes?.count ?? 0) + 1, since: strikes?.since ?? now });
		return 'bad-code';
	}

	end(party: Party): void {
		this.parties.delete(party.id);
		for (const [code, id] of this.codes) if (id === party.id) this.codes.delete(code);
	}

	/** Rotates due codes and drops stale parties. Returns what changed so the caller can notify. */
	tick(now: number): { rotated: Party[]; expired: Party[] } {
		const rotated: Party[] = [];
		const expired: Party[] = [];
		for (const [ip, strikes] of this.wrongCodes)
			if (now - strikes.since >= WRONG_CODE_WINDOW_MS) this.wrongCodes.delete(ip);
		for (const party of this.parties.values()) {
			if (now - party.lastActivity > PARTY_TTL_MS) {
				this.end(party);
				expired.push(party);
				continue;
			}
			if (party.previousCode && now - party.codeRotatedAt > CODE_GRACE_MS) {
				this.codes.delete(party.previousCode);
				party.previousCode = null;
			}
			if (now - party.codeRotatedAt >= CODE_ROTATE_MS) {
				this.assignCode(party, now);
				rotated.push(party);
			}
		}
		return { rotated, expired };
	}

	private assignCode(party: Party, now: number): void {
		let code = randomCode();
		while (this.codes.has(code)) code = randomCode();
		if (party.previousCode) this.codes.delete(party.previousCode);
		party.previousCode = party.code || null;
		party.code = code;
		party.codeRotatedAt = now;
		this.codes.set(code, party.id);
	}
}
