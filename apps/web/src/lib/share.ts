/**
 * The song link in what another app shared. Apps disagree on where they put it:
 * Spotify sends it inside `text`, others in `url`.
 */
export function sharedLink(params: Pick<URLSearchParams, 'get'>): string | null {
	for (const key of ['url', 'text', 'title']) {
		const link = params.get(key)?.match(/https?:\/\/\S+/)?.[0];
		if (link) return link;
	}
	return null;
}
