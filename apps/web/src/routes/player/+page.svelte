<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import QRCode from 'qrcode';
	import { m } from '#lib/paraglide/messages.js';
	import { PartyClient } from '#lib/party.svelte.ts';
	import { loadYouTube } from '#lib/youtube.ts';

	const HEARTBEAT_MS = 2_000;

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
	<main class="stage">
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

		<aside class="rail">
			<section>
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
			</section>
		</aside>
	</main>
{/if}

<style>
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		height: 100dvh;
	}
	.video {
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
	.rail {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 20px;
		background: var(--surface);
		overflow: hidden;
	}
	.rail section {
		display: grid;
		gap: 6px;
	}
	.next {
		flex: 1;
		align-content: start;
		overflow-y: auto;
	}
	.join {
		grid-template-columns: 120px 1fr;
		align-items: center;
		gap: var(--gap);
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

	@media (orientation: portrait) {
		.stage {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
		}
		.video {
			aspect-ratio: 16 / 9;
		}
	}
</style>
