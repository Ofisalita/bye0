import { afterAll, expect, test } from 'bun:test';
import { collectionExpander, matchingService, type Resolver } from './matching';

const SPOTIFY = 'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV';
const ALBUM = 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc';
const PLAYLIST = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const YOUTUBE = 'https://youtu.be/FGBhQbmPwH8';
const LIVE = 'https://www.youtube.com/live/jfKfPfyJRdk';

/** Answers like nidol's walking skeleton does. */
/** The last request body nidol got. */
let asked: Record<string, unknown> = {};
const nidol = Bun.serve({
	port: 0,
	async fetch(req) {
		asked = (await req.json()) as Record<string, unknown>;
		if (new URL(req.url).pathname === '/expand') {
			if (asked.input === PLAYLIST)
				return Response.json({ error: 'upstream_error', source: 'spotify' }, { status: 502 });
			if (asked.input !== ALBUM) return Response.json({ error: 'unsupported_input' }, { status: 422 });
			return Response.json({
				collection: { kind: 'album', platform: 'spotify', title: 'Discovery' },
				tracks: [
					{ title: 'One More Time', artists: ['Daft Punk'], durationMs: 320357, explicit: false, source: { platform: 'spotify', id: 'a', url: SPOTIFY } },
					{ title: 'Aerodynamic', artists: ['Daft Punk'], durationMs: null, explicit: false, source: { platform: 'spotify', id: 'b', url: 'https://open.spotify.com/track/b' } }
				],
				truncated: false
			});
		}
		const input = asked.input;
		if (input === SPOTIFY)
			return Response.json({
				canonical: { isrc: null, mbid: null, title: 'One More Time', artists: ['Daft Punk'], durationMs: 320357 },
				candidates: [
					{ videoId: 'wU26xVT_vBU', title: 'One More Time', channel: 'Daft Punk', durationMs: 321000, kind: 'official_audio', thumbnailUrl: 'x', confidence: 1 },
					{ videoId: 'YVdy1rK9F1E', title: 'one more time', channel: null, durationMs: null, kind: 'user_upload', thumbnailUrl: 'x', confidence: 0.6 }
				],
				needsConfirmation: false
			});
		if (input === LIVE)
			return Response.json({
				canonical: { title: 'lofi hip hop radio', artists: ['Lofi Girl'], durationMs: null, isLive: true },
				candidates: [{ videoId: 'jfKfPfyJRdk', title: 'lofi hip hop radio', channel: 'Lofi Girl', durationMs: null, kind: 'other', thumbnailUrl: 'x', confidence: 1 }],
				needsConfirmation: false
			});
		if (input === ALBUM) return Response.json({ error: 'collection_input', kind: 'album' }, { status: 409 });
		if (input === 'down') return Response.json({ error: 'search_unavailable' }, { status: 503 });
		return Response.json({ error: 'unsupported_input' }, { status: 422 });
	}
});
afterAll(() => nidol.stop(true));

const viaFallback: Resolver = async (input) => ({ title: `fallback ${input}`, artists: [], durationMs: 0, candidates: [] });
const resolve = matchingService(nidol.url.href, { country: 'CL', fallback: viaFallback });

test('a Spotify track comes back with ranked candidates, unknowns as 0 / empty', async () => {
	expect(await resolve(SPOTIFY)).toEqual({
		title: 'One More Time',
		artists: ['Daft Punk'],
		durationMs: 320357,
		candidates: [
			{ videoId: 'wU26xVT_vBU', title: 'One More Time', channel: 'Daft Punk', durationMs: 321000, kind: 'official_audio', confidence: 1, thumbnailUrl: 'x' },
			{ videoId: 'YVdy1rK9F1E', title: 'one more time', channel: '', durationMs: 0, kind: 'user_upload', confidence: 0.6, thumbnailUrl: 'x' }
		],
		needsConfirmation: false,
		isLive: undefined
	});
});

test('a live stream says so', async () => {
	expect(await resolve(LIVE)).toMatchObject({ durationMs: 0, isLive: true });
});

test('sends the country and the party\'s audio preference along', async () => {
	await resolve(SPOTIFY);
	expect(asked).toEqual({ input: SPOTIFY, target: 'youtube', country: 'CL', preferAudio: false });
	await resolve(SPOTIFY, { preferAudio: true });
	expect(asked).toMatchObject({ preferAudio: true });
	await matchingService(nidol.url.href)(SPOTIFY);
	expect(asked).not.toHaveProperty('country');
});

test('an album expands into its songs, with unknown durations as 0', async () => {
	const expand = collectionExpander(nidol.url.href);
	expect(await expand(ALBUM)).toEqual([
		{ title: 'One More Time', artists: ['Daft Punk'], durationMs: 320357, source: SPOTIFY },
		{ title: 'Aerodynamic', artists: ['Daft Punk'], durationMs: 0, source: 'https://open.spotify.com/track/b' }
	]);
	expect(await expand(PLAYLIST)).toBe('matching-unavailable');
	expect(await expand('https://example.com')).toBe('unresolvable');
});

test('a nidol without /expand reads as "collections not available"', async () => {
	const old = Bun.serve({ port: 0, fetch: () => Response.json({ detail: 'Not Found' }, { status: 404 }) });
	expect(await collectionExpander(old.url.href)(ALBUM)).toBe('collection');
	old.stop(true);
});

test('errors: collections, outages and everything else', async () => {
	expect(await resolve(ALBUM)).toBe('collection');
	expect(await resolve('down')).toBe('matching-unavailable');
	expect(await resolve('one more time')).toBe('unresolvable');
});

test('YouTube links nidol refuses go to the fallback', async () => {
	expect(await resolve(YOUTUBE)).toMatchObject({ title: `fallback ${YOUTUBE}` });
});

test('with nidol unreachable, YouTube links still resolve and the rest say so', async () => {
	const offline = matchingService('http://127.0.0.1:1', { fallback: viaFallback });
	expect(await offline(YOUTUBE)).toMatchObject({ title: `fallback ${YOUTUBE}` });
	expect(await offline(SPOTIFY)).toBe('matching-unavailable');
});
