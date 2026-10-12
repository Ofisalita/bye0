<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CONFIRM_MS, GOVERNANCES, ORDERINGS, skipVotesNeeded, type PartyContext, type QueueItem, type Resolution } from '@bye0/shared';
	import CandidatePicker from '#lib/CandidatePicker.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { party } from '#lib/party.svelte.ts';
	import { errorText, label } from '#lib/text.ts';

	const COOLDOWN_CHOICES = [null, 15_000, 30_000, 60_000, 120_000, 300_000];

	let input = $state('');
	/** Queue length when the last add was sent; the add is done once it changes or an error arrives. */
	let addingSince = $state<number | null>(null);

	const s = $derived(party.state);
	const np = $derived(s?.nowPlaying ?? null);
	const canManage = $derived(party.me?.role !== 'guest');
	const queued = $derived((s?.queue.length ?? 0) + (np ? 1 : 0));
	const adding = $derived(addingSince !== null && addingSince === queued && !party.error);
	const ctx = $derived<PartyContext | null>(s ? { ...s, lastPlayedAt: {}, now: s.serverNow } : null);
	const governance = $derived(s ? GOVERNANCES[s.settings.governance] : undefined);
	const skip = $derived(ask({ type: 'skip' }));
	const voted = $derived(skip?.kind === 'deny' && skip.reason === 'already-voted');
	const tally = $derived(ctx && np ? { have: np.skipVotes.length, needed: skipVotesNeeded(ctx) } : null);

	/** Ticks once a second so countdowns (add cooldown, match confirmation) move. */
	let clock = $state(Date.now());
	$effect(() => {
		const tick = setInterval(() => (clock = Date.now()), 1_000);
		return () => clearInterval(tick);
	});
	const serverNow = $derived(clock + party.clockOffset);
	const waitSeconds = $derived.by(() => {
		const cooldown = s?.settings.addCooldownMs;
		const last = party.me?.lastAddedAt;
		if (!cooldown || last == null) return 0;
		return Math.ceil(Math.min(cooldown, last + cooldown - serverNow) / 1000);
	});

	/** My most recent song whose match the server wants me to confirm, while there's still time. */
	const confirming = $derived(
		[...(s?.queue ?? []), ...(np ? [np.item] : [])]
			.filter((i) => i.addedBy === party.you && i.confirmBy !== undefined && i.confirmBy > serverNow)
			.sort((a, b) => b.addedAt - a.addedAt)[0]
	);
	const confirmSeconds = $derived(
		confirming?.confirmBy ? Math.ceil(Math.min(CONFIRM_MS, confirming.confirmBy - serverNow) / 1000) : 0
	);
	/** Item whose versions the host has open. */
	let picking = $state<string | null>(null);
	const canPick = (item: QueueItem) => party.isHost && item.candidates.length > 1;

	function pick(itemId: string, candidateIndex: number) {
		party.send({ t: 'pick', itemId, candidateIndex });
		picking = null;
	}

	type Ask = { type: 'skip' } | { type: 'remove' | 'bump'; item: QueueItem };
	/** What the active rules would answer if this guest tried it. The server has the last word. */
	function ask(intent: Ask): Resolution | null {
		if (!ctx || !governance || !party.you) return null;
		return governance.handle({ ...intent, by: party.you }, ctx);
	}
	const may = (intent: Ask) => ask(intent)?.kind === 'apply';

	if (!party.state && party.status === 'idle' && !party.resume()) goto(resolve('/'));

	$effect(() => {
		if (!adding) addingSince = null;
	});

	const nameOf = (id: string) => s?.guests.find((g) => g.id === id)?.nickname ?? '?';
	const subtitle = (item: QueueItem) =>
		[item.artists.join(', '), s?.settings.showAttribution ? m.added_by({ name: nameOf(item.addedBy) }) : '']
			.filter(Boolean)
			.join(' · ');

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
				<div class="row">
					<div class="grow">
						<p class="ellipsis"><strong>{np.item.title}</strong></p>
						<p class="dim ellipsis">{subtitle(np.item)}</p>
					</div>
					{#if canPick(np.item)}
						<button class="small" aria-expanded={picking === np.item.id} onclick={() => (picking = picking === np.item.id ? null : np.item.id)}>
							{m.change_version()}
						</button>
					{/if}
				</div>
				{#if picking === np.item.id}
					<CandidatePicker item={np.item} onpick={(i) => pick(np.item.id, i)} />
				{/if}
				{#if !s.playerId}
					<p class="dim">{m.no_player()}</p>
				{:else if np.paused}
					<p class="dim">{m.paused()}</p>
				{/if}
				{#if tally && (skip?.kind === 'vote' || voted)}
					<button disabled={voted} onclick={() => party.send({ t: 'skip' })}>
						{(voted ? m.skip_voted : m.skip_vote)(tally)}
					</button>
				{:else}
					<button disabled={skip?.kind !== 'apply'} onclick={() => party.send({ t: 'skip' })}>{m.skip()}</button>
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
				<button class="primary" disabled={!input.trim() || waitSeconds > 0}>{m.add_action()}</button>
			{/if}
		</form>
		{#if adding}
			<p class="dim" role="status">{m.adding()}</p>
		{:else if waitSeconds > 0}
			<p class="dim" role="status">{m.add_cooldown_wait({ seconds: waitSeconds })}</p>
		{/if}

		{#if confirming}
			{@const item = confirming}
			<section class="card confirm">
				<h2>{m.confirm_title()}</h2>
				<p class="dim" role="status">{m.confirm_hint({ title: item.title, seconds: confirmSeconds })}</p>
				<CandidatePicker {item} onpick={(i) => pick(item.id, i)} />
			</section>
		{/if}

		<section class="card">
			<h2>{m.up_next()}</h2>
			{#each s.queue as item (item.id)}
				<div class="row">
					<div class="grow">
						<p class="ellipsis">{item.title}</p>
						<p class="dim ellipsis">{subtitle(item)}</p>
					</div>
					{#if canPick(item)}
						<button class="small" aria-expanded={picking === item.id} onclick={() => (picking = picking === item.id ? null : item.id)}>
							{m.change_version()}
						</button>
					{/if}
					{#if may({ type: 'bump', item })}
						<button class="small" onclick={() => party.send({ t: 'bump', itemId: item.id })}>{m.bump()}</button>
					{/if}
					{#if may({ type: 'remove', item })}
						<button class="small danger" onclick={() => party.send({ t: 'remove', itemId: item.id })}>{m.remove()}</button>
					{/if}
				</div>
				{#if picking === item.id}
					<CandidatePicker {item} onpick={(i) => pick(item.id, i)} />
				{/if}
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
				{#if governance?.votesToSkip}
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
				<label>
					<span class="dim">{m.add_cooldown()}</span>
					<select
						value={String(s.settings.addCooldownMs)}
						onchange={(e) => party.send({ t: 'settings', patch: { addCooldownMs: Number(e.currentTarget.value) || null } })}
					>
						{#each COOLDOWN_CHOICES as ms (ms)}
							<option value={String(ms)}>
								{ms === null ? m.add_cooldown_off() : ms < 60_000 ? m.seconds({ n: ms / 1000 }) : m.minutes({ n: ms / 60_000 })}
							</option>
						{/each}
					</select>
				</label>
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
	.confirm {
		outline: 2px solid var(--accent);
	}
</style>
