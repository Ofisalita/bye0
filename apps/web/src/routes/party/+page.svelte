<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { GOVERNANCES, ORDERINGS, skipVotesNeeded, type QueueItem } from '@bye0/shared';
	import { m } from '#lib/paraglide/messages.js';
	import { party } from '#lib/party.svelte.ts';
	import { errorText, label } from '#lib/text.ts';

	let input = $state('');
	/** Queue length when the last add was sent; the add is done once it changes or an error arrives. */
	let addingSince = $state<number | null>(null);

	const s = $derived(party.state);
	const np = $derived(s?.nowPlaying ?? null);
	const canManage = $derived(party.me?.role !== 'guest');
	const queued = $derived((s?.queue.length ?? 0) + (np ? 1 : 0));
	const adding = $derived(addingSince !== null && addingSince === queued && !party.error);
	const votes = $derived(
		s && np
			? {
					have: np.skipVotes.length,
					needed: skipVotesNeeded({ ...s, lastPlayedAt: {}, now: s.serverNow }),
					mine: np.skipVotes.includes(party.you ?? '')
				}
			: null
	);

	if (!party.state && party.status === 'idle' && !party.resume()) goto(resolve('/'));

	$effect(() => {
		if (!adding) addingSince = null;
	});

	const nameOf = (id: string) => s?.guests.find((g) => g.id === id)?.nickname ?? '?';
	const subtitle = (item: QueueItem) =>
		[item.artists.join(', '), s?.settings.showAttribution ? m.added_by({ name: nameOf(item.addedBy) }) : '']
			.filter(Boolean)
			.join(' · ');
	const canRemove = (item: QueueItem) => party.isHost || item.addedBy === party.you;

	function add(e: SubmitEvent) {
		e.preventDefault();
		if (!input.trim()) return;
		party.send({ t: 'add', input });
		addingSince = queued;
		input = '';
	}

	async function paste() {
		input = await navigator.clipboard.readText().catch(() => input);
	}

	function end() {
		if (confirm(m.end_party_confirm())) party.send({ t: 'end' });
	}
</script>

{#if party.status === 'ended'}
	<main class="page">
		<p>{party.error ? errorText(party.error) : m.party_ended()}</p>
		<a href={resolve('/')}>{m.back_home()}</a>
	</main>
{:else if !s}
	<main class="page"><p class="dim">{m.connecting()}</p></main>
{:else}
	<main class="page">
		<header class="row">
			<h1 class="grow">bye0</h1>
			<span class="code">{s.code}</span>
		</header>

		{#if party.status === 'connecting'}
			<p class="dim" role="status">{m.reconnecting()}</p>
		{/if}

		<section class="card">
			<h2>{m.now_playing()}</h2>
			{#if np}
				<div>
					<p class="ellipsis"><strong>{np.item.title}</strong></p>
					<p class="dim ellipsis">{subtitle(np.item)}</p>
				</div>
				{#if !s.playerId}
					<p class="dim">{m.no_player()}</p>
				{:else if np.paused}
					<p class="dim">{m.paused()}</p>
				{/if}
				{#if party.isHost || s.settings.governance === 'dictatorship'}
					<button disabled={!party.isHost} onclick={() => party.send({ t: 'skip' })}>{m.skip()}</button>
				{:else if votes}
					<button disabled={votes.mine} onclick={() => party.send({ t: 'skip' })}>
						{(votes.mine ? m.skip_voted : m.skip_vote)(votes)}
					</button>
				{/if}
			{:else}
				<p class="dim">{s.started ? m.nothing_playing() : m.not_started()}</p>
			{/if}
			{#if canManage && !s.playerId}
				<a class="button" href={resolve('/player')}>{m.open_player()}</a>
			{/if}
		</section>

		<form class="row" onsubmit={add}>
			<input class="grow" type="text" bind:value={input} placeholder={m.add_placeholder()} aria-label={m.add_placeholder()} inputmode="url" />
			{#if !input && 'clipboard' in navigator}
				<button type="button" onclick={paste}>{m.add_paste()}</button>
			{:else}
				<button class="primary" disabled={!input.trim()}>{m.add_action()}</button>
			{/if}
		</form>
		{#if adding}
			<p class="dim" role="status">{m.adding()}</p>
		{/if}

		<section class="card">
			<h2>{m.up_next()}</h2>
			{#each s.queue as item (item.id)}
				<div class="row">
					<div class="grow">
						<p class="ellipsis">{item.title}</p>
						<p class="dim ellipsis">{subtitle(item)}</p>
					</div>
					{#if party.isHost}
						<button class="small" onclick={() => party.send({ t: 'bump', itemId: item.id })}>{m.bump()}</button>
					{/if}
					{#if canRemove(item)}
						<button class="small danger" onclick={() => party.send({ t: 'remove', itemId: item.id })}>{m.remove()}</button>
					{/if}
				</div>
			{:else}
				<p class="dim">{m.queue_empty()}</p>
			{/each}
		</section>

		{#if party.isHost}
			<section class="card">
				<h2>{m.host_controls()}</h2>
				<label>
					<span class="dim">{m.ordering()}</span>
					<select value={s.settings.ordering} onchange={(e) => party.send({ t: 'settings', patch: { ordering: e.currentTarget.value } })}>
						{#each Object.keys(ORDERINGS) as id (id)}
							<option value={id}>{label(id)}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="dim">{m.governance()}</span>
					<select value={s.settings.governance} onchange={(e) => party.send({ t: 'settings', patch: { governance: e.currentTarget.value } })}>
						{#each Object.keys(GOVERNANCES) as id (id)}
							<option value={id}>{label(id)}</option>
						{/each}
					</select>
				</label>
				{#if s.settings.governance === 'democracy'}
					<label>
						<span class="dim">{m.skip_threshold({ percent: Math.round(s.settings.skipThreshold * 100) })}</span>
						<input
							type="range"
							min="0.1"
							max="1"
							step="0.1"
							value={s.settings.skipThreshold}
							onchange={(e) => party.send({ t: 'settings', patch: { skipThreshold: Number(e.currentTarget.value) } })}
						/>
					</label>
				{/if}
				<label class="row">
					<input
						type="checkbox"
						checked={s.settings.showAttribution}
						onchange={(e) => party.send({ t: 'settings', patch: { showAttribution: e.currentTarget.checked } })}
					/>
					{m.show_attribution()}
				</label>
			</section>
		{/if}

		<section class="card">
			<h2>{m.guests()} ({s.guests.length})</h2>
			{#each s.guests as guest (guest.id)}
				<div class="row">
					<p class="grow ellipsis">
						{guest.nickname}
						<span class="dim">
							{guest.role === 'host' ? m.role_host() : guest.role === 'cohost' ? m.role_cohost() : ''}
							{guest.connected ? '' : m.offline()}
						</span>
					</p>
					{#if party.isHost && guest.role !== 'host'}
						<button
							class="small"
							onclick={() => party.send({ t: 'role', guestId: guest.id, role: guest.role === 'cohost' ? 'guest' : 'cohost' })}
						>
							{guest.role === 'cohost' ? m.remove_cohost() : m.make_cohost()}
						</button>
						<button class="small danger" onclick={() => party.send({ t: 'kick', guestId: guest.id })}>{m.kick()}</button>
					{/if}
				</div>
			{/each}
		</section>

		{#if party.isHost}
			<button class="danger" onclick={end}>{m.end_party()}</button>
		{/if}
	</main>

	{#if party.error}
		<p class="toast" role="alert">{errorText(party.error)}</p>
	{/if}
{/if}

<style>
	.code {
		padding: 4px 12px;
		border-radius: var(--radius);
		background: var(--surface);
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: 0.2em;
	}
	a.button {
		display: grid;
		place-items: center;
		min-height: 44px;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 700;
		text-decoration: none;
	}
	input[type='range'] {
		width: 100%;
	}
</style>
