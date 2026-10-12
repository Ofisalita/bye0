<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import QRCode from 'qrcode';
	import { m } from '#lib/paraglide/messages.js';
	import { PartyClient } from '#lib/party.svelte.ts';
	import { loadYouTube } from '#lib/youtube.ts';

	const HEARTBEAT_MS = 2_000;
	const LAYOUT_KEY = 'bye0.playerLayout';

	// Own connection: closing this view is what releases the Player role.
	const party = new PartyClient();
	if (!party.resume()) goto(resolve('/'));

	let frame = $state<HTMLDivElement>();
	let player = $state<YT.Player>();
	/** Set by the tap that iOS needs before any audio. */
	let tapped = $state(false);
	let qr = $state('');
	/** `${itemId}:${candidateIndex}` of what the iframe was last told to load. */
	let loaded = '';
	/** `video`: big video with a side rail. `queue`: small video, big queue. Kept per device. */
	let layout = $state<'video' | 'queue'>(localStorage.getItem(LAYOUT_KEY) === 'queue' ? 'queue' : 'video');

	const s = $derived(party.state);
	const np = $derived(s?.nowPlaying ?? null);
	const allowed = $derived(party.me !== undefined && party.me.role !== 'guest');
	// Another device may take over; then this one goes back to the start button.
	const active = $derived(tapped && s?.playerId === party.you);
	const joinUrl = $derived(s ? `${location.origin}/?code=${s.code}` : '');

	$effect(() => {
		if (joinUrl) QRCode.toDataURL(joinUrl, { margin: 1, width: 320 }).then((url) => (qr = url));
	});

	$effect(() => {
		if (!player) return;
		if (!active || !np) {
			loaded = '';
			player.stopVideo();
			return;
		}
		const key = `${np.item.id}:${np.item.candidateIndex}`;
		if (key === loaded) return;
		loaded = key;
		// Non-zero when taking over from a player that dropped mid-song.
		const elapsed = np.paused ? 0 : Date.now() + party.clockOffset - np.positionAt;
		player.loadVideoById({
			videoId: np.item.candidates[np.item.candidateIndex]!.videoId,
			startSeconds: Math.max(0, (np.positionMs + elapsed) / 1000)
		});
	});

	const heartbeat = setInterval(() => {
		const item = party.state?.nowPlaying?.item;
		if (!active || !player || !item || `${item.id}:${item.candidateIndex}` !== loaded) return;
		const state = player.getPlayerState();
		if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED) return;
		party.send({
			t: 'player.heartbeat',
			itemId: item.id,
			positionMs: Math.round(player.getCurrentTime() * 1000),
			paused: state === YT.PlayerState.PAUSED
		});
	}, HEARTBEAT_MS);

	let wakeLock: WakeLockSentinel | undefined;
	async function keepAwake() {
		if (document.visibilityState !== 'visible' || !tapped) return;
		wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined);
	}
	// The browser drops the lock whenever the tab is hidden.
	document.addEventListener('visibilitychange', keepAwake);

	onDestroy(() => {
		clearInterval(heartbeat);
		document.removeEventListener('visibilitychange', keepAwake);
		wakeLock?.release();
		player?.destroy();
		party.close();
	});

	function switchLayout() {
		layout = layout === 'video' ? 'queue' : 'video';
		localStorage.setItem(LAYOUT_KEY, layout);
	}

	async function start() {
		tapped = true;
		party.send({ t: 'player.claim' });
		if (party.isHost && !s?.started) party.send({ t: 'start' });
		keepAwake();
		if (player) return;
		const yt = await loadYouTube();
		new yt.Player(frame!, {
			width: '100%',
			height: '100%',
			playerVars: { playsinline: 1, rel: 0 },
			events: {
				onReady: (e) => (player = e.target),
				onStateChange: (e) => {
					const item = party.state?.nowPlaying?.item;
					if (e.data === yt.PlayerState.ENDED && item) party.send({ t: 'player.ended', itemId: item.id });
				},
				onError: (e) => {
					const item = party.state?.nowPlaying?.item;
					if (item) party.send({ t: 'player.error', itemId: item.id, code: e.data });
				}
			}
		});
	}
</script>

{#if party.status === 'ended'}
	<main class="page">
		<p>{m.party_ended()}</p>
		<a href={resolve('/')}>{m.back_home()}</a>
	</main>
{:else if !s}
	<main class="page"><p class="dim">{m.connecting()}</p></main>
{:else}
	<main class="stage" class:queue={layout === 'queue'}>
		<!-- Nothing may be drawn over the video (YouTube's Required Minimum Functionality). -->
		<div class="video">
			<div class="frame" class:hidden={!active}><div bind:this={frame}></div></div>
			{#if !active}
				<div class="start">
					{#if allowed}
						<button class="primary" onclick={start}>{m.player_start()}</button>
						<p class="dim">{m.player_start_hint()}</p>
					{:else}
						<p>{m.player_not_allowed()}</p>
					{/if}
					<a href={resolve('/party')}>{m.back_to_party()}</a>
				</div>
			{/if}
		</div>

		<section class="now">
			<h2>{m.now_playing()}</h2>
			{#if np}
				<p><strong>{np.item.title}</strong></p>
				<p class="dim">{np.item.artists.join(', ')}</p>
			{:else}
				<p class="dim">{m.nothing_playing()}</p>
			{/if}
		</section>

		<section class="next">
			<h2>{m.up_next()}</h2>
			{#each s.queue as item (item.id)}
				<p class="ellipsis">{item.title} <span class="dim">{item.artists.join(', ')}</span></p>
			{:else}
				<p class="dim">{m.queue_empty()}</p>
			{/each}
		</section>

		<section class="join">
			{#if qr}<img src={qr} alt={joinUrl} />{/if}
			<div>
				<p class="dim">{m.player_join({ host: location.host })}</p>
				<p class="code">{s.code}</p>
			</div>
			<button class="small layout" onclick={switchLayout}>
				{layout === 'video' ? m.player_layout_queue() : m.player_layout_video()}
			</button>
		</section>
	</main>
{/if}

<style>
	.stage {
		display: grid;
		grid-template:
			'video now' auto
			'video next' minmax(0, 1fr)
			'video join' auto / minmax(0, 1fr) 340px;
		height: 100dvh;
		background: var(--surface);
	}
	.video {
		grid-area: video;
		position: relative;
		background: #000;
		min-height: 200px;
	}
	.frame {
		position: absolute;
		inset: 0;
	}
	.frame.hidden {
		visibility: hidden;
	}
	.frame :global(iframe) {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}
	.start {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--gap);
		padding: 16px;
		text-align: center;
	}
	section {
		display: grid;
		gap: 6px;
		min-width: 0;
		padding: 12px 20px;
	}
	.now {
		grid-area: now;
		padding-top: 20px;
	}
	.next {
		grid-area: next;
		align-content: start;
		overflow-y: auto;
	}
	.join {
		grid-area: join;
		grid-template-columns: 120px 1fr;
		align-items: center;
		gap: var(--gap);
		padding-bottom: 20px;
	}
	.join img {
		width: 120px;
		border-radius: 8px;
	}
	.code {
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: 0.2em;
	}
	.layout {
		grid-column: 1 / -1;
	}

	/* Small video, big queue. */
	@media (orientation: landscape) {
		.stage.queue {
			/* 360px keeps a 16:9 video above the 200px YouTube asks for. */
			grid-template:
				'video next' auto
				'now next' auto
				'join next' minmax(0, 1fr) / minmax(360px, 30%) minmax(0, 1fr);
		}
		.queue .video {
			aspect-ratio: 16 / 9;
		}
		.queue .next {
			gap: 20px;
			padding: 32px 40px;
			background: var(--bg);
			font-size: 2rem;
			line-height: 1.2;
		}
		.queue .next .dim {
			display: block;
			font-size: 1.2rem;
		}
		.queue .join {
			align-self: end;
		}
	}

	/* One stacked layout, whichever is picked. */
	@media (orientation: portrait) {
		.stage {
			grid-template:
				'video' auto
				'now' auto
				'next' minmax(0, 1fr)
				'join' auto / minmax(0, 1fr);
		}
		.video {
			aspect-ratio: 16 / 9;
		}
		.layout {
			display: none;
		}
	}
</style>
