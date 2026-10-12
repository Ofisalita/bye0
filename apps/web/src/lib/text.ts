import type { ErrorCode } from '@bye0/shared';
import { m } from '#lib/paraglide/messages.js';

const ERRORS: Record<ErrorCode, () => string> = {
	'bad-request': m.error_bad_request,
	'bad-code': m.error_bad_code,
	'party-gone': m.error_party_gone,
	banned: m.error_banned,
	'rate-limited': m.error_rate_limited,
	'not-allowed': m.error_not_allowed,
	'already-voted': m.error_already_voted,
	'nothing-playing': m.error_nothing_playing,
	unresolvable: m.error_unresolvable,
	collection: m.error_collection,
	'matching-unavailable': m.error_matching_unavailable,
	'too-long': m.error_too_long,
	'queue-limit': m.error_queue_limit,
	cooldown: m.error_cooldown,
	locked: m.error_locked,
	'other-network': m.error_other_network
};
export const errorText = (code: ErrorCode) => ERRORS[code]();

/** 3:05, 1:02:03, or '' when unknown (0). */
export function duration(ms: number): string {
	if (!ms) return '';
	const total = Math.round(ms / 1000);
	const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
	const pad = (n: number) => String(n).padStart(2, '0');
	return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Keyed by strategy / preset id. A missing entry falls back to the raw id.
const LABELS: Record<string, () => string> = {
	fifo: m.ordering_fifo,
	'round-robin': m.ordering_round_robin,
	'vote-ranked': m.ordering_vote_ranked,
	hot: m.ordering_hot,
	shuffle: m.ordering_shuffle,
	dictatorship: m.governance_dictatorship,
	anarchy: m.governance_anarchy,
	'full-democracy': m.governance_full_democracy,
	'presidential-democracy': m.governance_presidential_democracy,
	'chill-dinner': m.preset_chill_dinner,
	'house-party': m.preset_house_party,
	chaos: m.preset_chaos
};
export const label = (id: string) => LABELS[id]?.() ?? id;

const HINTS: Record<string, () => string> = {
	'chill-dinner': m.preset_chill_dinner_hint,
	'house-party': m.preset_house_party_hint,
	chaos: m.preset_chaos_hint
};
export const hint = (id: string) => HINTS[id]?.() ?? '';
