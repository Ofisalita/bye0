<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ErrorCode } from '@bye0/shared';
	import { m } from '#lib/paraglide/messages.js';
	import { party } from '#lib/party.svelte.ts';
	import { sharedLink } from '#lib/share.ts';
	import { errorText } from '#lib/text.ts';

	// Opened by Android's share sheet (the manifest's share_target) and by the iOS Shortcut,
	// both as /share?url=…&text=…&title=…
	const link = sharedLink(page.url.searchParams);
	const inParty = link !== null && (party.state !== null || party.status !== 'idle' || party.resume());

	/** Queue length when the add was sent; it is done once that changes or an error arrives. */
	let sentAt: number | null = null;
	let failed = $state<ErrorCode | null>(null);

	const queued = $derived(party.state ? party.state.queue.length + (party.state.nowPlaying ? 1 : 0) : null);

	$effect(() => {
		if (!link || party.status !== 'open' || queued === null) return;
		if (sentAt === null) {
			sentAt = queued;
			party.send({ t: 'add', input: link });
		} else if (queued !== sentAt) goto(resolve('/party'), { replaceState: true });
	});

	$effect(() => {
		// `party.error` first: it is the one the effect has to track.
		if (party.error && sentAt !== null) failed = party.error;
	});
</script>

<main class="page">
	<h1>bye0</h1>
	{#if !link}
		<p>{m.share_no_link()}</p>
		<a href={resolve('/')}>{m.back_home()}</a>
	{:else if !inParty || party.status === 'ended'}
		<p>{m.share_no_party()}</p>
		<a href={resolve('/')}>{m.back_home()}</a>
	{:else if failed}
		<p role="alert">{errorText(failed)}</p>
		<a href={resolve('/party')}>{m.back_to_party()}</a>
	{:else}
		<p class="dim" role="status">{party.status === 'open' ? m.adding() : m.connecting()}</p>
	{/if}
</main>
