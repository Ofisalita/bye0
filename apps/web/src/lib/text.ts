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
	'too-long': m.error_too_long,
	'queue-limit': m.error_queue_limit
};
export const errorText = (code: ErrorCode) => ERRORS[code]();

// Keyed by strategy / preset id. A missing entry falls back to the raw id.
const LABELS: Record<string, () => string> = {
	fifo: m.ordering_fifo,
	'round-robin': m.ordering_round_robin,
	dictatorship: m.governance_dictatorship,
	democracy: m.governance_democracy,
	'chill-dinner': m.preset_chill_dinner,
	'house-party': m.preset_house_party
};
export const label = (id: string) => LABELS[id]?.() ?? id;

const HINTS: Record<string, () => string> = {
	'chill-dinner': m.preset_chill_dinner_hint,
	'house-party': m.preset_house_party_hint
};
export const hint = (id: string) => HINTS[id]?.() ?? '';
