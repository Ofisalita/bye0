import type { ErrorCode } from '@bye0/shared';
import type { ResolvedTrack } from './party';

const TIMEOUT_MS = 8_000;

export type Resolver = (input: string) => Promise<ResolvedTrack | ErrorCode>;

/** Pulls the video id out of youtube.com / music.youtube.com / youtu.be links. */
export function youtubeId(input: string): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^(www|m|music)\./, '');
	let id: string | null | undefined;
	if (host === 'youtu.be') id = url.pathname.split('/')[1];
	else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
		const [, first, second] = url.pathname.split('/');
		id = first === 'watch' ? url.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(first ?? '') ? second : null;
	}
	return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** The parts of nidol's `POST /resolve` response we use (contract: MATCHING_SERVICE.md in Ofisalita/nidol). */
interface ResolveResponse {
	canonical: { title: string; artists: string[]; durationMs: number | null };
	candidates: {
		videoId: string;
		title: string;
		channel: string | null;
		durationMs: number | null;
		kind: string;
		confidence: number;
	}[];
}

async function askNidol(baseUrl: string, input: string): Promise<ResolvedTrack | ErrorCode> {
	const res = await fetch(new URL('/resolve', baseUrl), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ input, target: 'youtube' }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	// 409 collection_input: an album or playlist link. 5xx: nidol or one of its sources is down.
	if (res.status === 409) return 'collection';
	if (res.status >= 500) return 'matching-unavailable';
	if (!res.ok) return 'unresolvable';
	const body = (await res.json()) as ResolveResponse;
	// TODO: `needsConfirmation` should open the QTE prompt (SPEC §4); for now the top candidate wins.
	return {
		title: body.canonical.title,
		artists: body.canonical.artists,
		durationMs: body.canonical.durationMs ?? 0,
		candidates: body.candidates.map((c) => ({
			videoId: c.videoId,
			title: c.title,
			channel: c.channel ?? '',
			durationMs: c.durationMs ?? 0,
			kind: c.kind,
			confidence: c.confidence
		}))
	};
}

/**
 * Talks to the matching service (nidol). A YouTube link is playable as it is, so when nidol
 * can't take it (it doesn't accept them yet) or is down, `fallback` resolves it instead.
 */
export function matchingService(baseUrl: string, fallback: Resolver = youtubeOnly): Resolver {
	return async (input) => {
		const result = await askNidol(baseUrl, input).catch((err): ErrorCode => {
			console.error('matching service failed:', err);
			return 'matching-unavailable';
		});
		return typeof result === 'string' && youtubeId(input) ? fallback(input) : result;
	};
}

/**
 * Stand-in used when MATCHING_URL isn't set: accepts YouTube links only and
 * reads the title from YouTube's oEmbed endpoint. Duration is unknown (0).
 */
export const youtubeOnly: Resolver = async (input) => {
	const videoId = youtubeId(input);
	if (!videoId) return 'unresolvable';
	const oembed = new URL('https://www.youtube.com/oembed?format=json');
	oembed.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
	const res = await fetch(oembed, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) return 'unresolvable';
	const meta = (await res.json()) as { title: string; author_name: string };
	return {
		title: meta.title,
		artists: [meta.author_name],
		durationMs: 0,
		candidates: [{ videoId, title: meta.title, channel: meta.author_name, durationMs: 0 }]
	};
};
