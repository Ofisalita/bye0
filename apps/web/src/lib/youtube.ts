/// <reference types="youtube" />
let api: Promise<typeof YT> | undefined;

/** Loads YouTube's IFrame Player API once. */
export function loadYouTube(): Promise<typeof YT> {
	api ??= new Promise((resolve) => {
		(window as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => resolve(YT);
		const script = document.createElement('script');
		script.src = 'https://www.youtube.com/iframe_api';
		document.head.append(script);
	});
	return api;
}
