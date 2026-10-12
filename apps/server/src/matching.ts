import type { Candidate } from '@bye0/shared';
import type { ResolvedTrack } from './party';

const TIMEOUT_MS = 8_000;

export type Resolver = (input: string) => Promise<ResolvedTrack | null>;

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

/** Talks to the matching service (contract: MATCHING_SERVICE.md in Ofisalita/nidol). */
export function matchingService(baseUrl: string): Resolver {
	return async (input) => {
		const res = await fetch(new URL('/resolve', baseUrl), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ input, target: 'youtube' }),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const body = (await res.json()) as {
			canonical: { title: string; artists: string[]; durationMs: number };
			candidates: Candidate[];
		};
		// TODO: `needsConfirmation` should open the QTE prompt (SPEC §4); for now the top candidate wins.
		return {
			title: body.canonical.title,
			artists: body.canonical.artists,
			durationMs: body.canonical.durationMs,
			candidates: body.candidates
		};
	};
}

/**
 * Stand-in used when MATCHING_URL isn't set: accepts YouTube links only and
 * reads the title from YouTube's oEmbed endpoint. Duration is unknown (0).
 */
export const youtubeOnly: Resolver = async (input) => {
	const videoId = youtubeId(input);
	if (!videoId) return null;
	const oembed = new URL('https://www.youtube.com/oembed?format=json');
	oembed.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
	const res = await fetch(oembed, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) return null;
	const meta = (await res.json()) as { title: string; author_name: string };
	return {
		title: meta.title,
		artists: [meta.author_name],
		durationMs: 0,
		candidates: [{ videoId, title: meta.title, channel: meta.author_name, durationMs: 0 }]
	};
};
