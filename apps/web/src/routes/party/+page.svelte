<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		canSwap,
		CONFIRM_MS,
		GOVERNANCES,
		isLocked,
		ORDERINGS,
		skipVotesNeeded,
		type PartyContext,
		type PartySettings,
		type QueueItem,
		type Resolution
	} from '@bye0/shared';
	import CandidatePicker from '#lib/CandidatePicker.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { party } from '#lib/party.svelte.ts';
	import { duration, errorText, label } from '#lib/text.ts';

	// Choices for the host's limits; null turns a limit off.
	const MAX_DURATION_CHOICES = [null, 5, 7, 10, 15, 20, 30].map((min) => min && min * 60_000);
	const MAX_QUEUED_CHOICES = [null, 1, 2, 3, 5, 10];
	const COOLDOWN_CHOICES = [null, 15_000, 30_000, 60_000, 120_000, 300_000];
	const AUTO_LOCK_CHOICES = [null, 15, 30, 60, 120, 180].map((min) => min && min * 60_000);
	type Limit = 'maxDurationMs' | 'maxQueuedPerGuest' | 'addCooldownMs' | 'autoLockMs';
	const setLimit = (key: Limit, value: string) =>
		party.send({ t: 'settings', patch: { [key]: Number(value) || null } as Partial<PartySettings> });
	const span = (ms: number) =>
		ms < 60_000 ? m.seconds({ n: ms / 1000 }) : ms < 3_600_000 ? m.minutes({ n: ms / 60_000 }) : m.hours({ n: ms / 3_600_000 });

	let input = $state('');
	/** Queue length when the last add was sent; the add is done once it changes or an error arrives. */
	let addingSince = $state<number | null>(null);

	const s = $derived(party.state);
	const np = $derived(s?.nowPlaying ?? null);
	const canManage = $derived(party.me?.role !== 'guest');
	const queued = $derived((s?.queue.length ?? 0) + (np ? 1 : 0));
	const adding = $derived(addingSince !== null && addingSince === queued && !party.error);
	/** Guests who are in, and those waiting in the lobby for the host. */
	const members = $derived(s?.guests.filter((g) => !g.pending) ?? []);
	const waiting = $derived(s?.guests.filter((g) => g.pending) ?? []);
	const ctx = $derived<PartyContext | null>(s ? { ...s, guests: members, lastPlayedAt: {}, now: s.serverNow } : null);
	const governance = $derived(s ? GOVERNANCES[s.settings.governance] : undefined);
	const ordering = $derived(s ? ORDERINGS[s.settings.ordering] : undefined);
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
	const locked = $derived(s ? isLocked(s.settings, s.createdAt, serverNow) : false);
	/** When the auto-lock kicks in, on this device's clock; null if it's off or already happened. */
	const locksAt = $derived(
		s?.settings.autoLockMs && !locked ? new Date(s.createdAt + s.settings.autoLockMs - party.clockOffset) : null
	);

	function setLocked(on: boolean) {
		// Unlocking after an auto-lock also turns the auto-lock off, or it would lock again at once.
		const autoLocked = !s?.settings.locked && locked;
		party.send({ t: 'settings', patch: on ? { locked: true } : { locked: false, ...(autoLocked && { autoLockMs: null }) } });
	}

	/** Item whose versions the host has open. */
	let picking = $state<string | null>(null);
	const canPick = (item: QueueItem) => party.isHost && item.candidates.length > 1;

	function pick(itemId: string, candidateIndex: number) {
		party.send({ t: 'pick', itemId, candidateIndex });
		picking = null;
	}

	type Ask = { type: 'skip' } | { type: 'remove' | 'bump'; item: QueueItem } | { type: 'swap'; item: QueueItem; other: QueueItem };
	/** What the active rules would answer if this guest tried it. The server has the last word. */
	function ask(intent: Ask): Resolution | null {
		if (!ctx || !governance || !party.you) return null;
		return governance.handle({ ...intent, by: party.you }, ctx);
	}
	const may = (intent: Ask) => ask(intent)?.kind === 'apply';

	/** The nearest song up (-1) or down (1) the queue that this guest may swap the one at `index` with. */
	function swapTarget(index: number, step: -1 | 1): QueueItem | undefined {
		const queue = s?.queue ?? [];
		const item = queue[index];
		if (!item || !ordering?.swaps) return undefined;
		for (let i = index + step; queue[i]; i += step) {
			const other = queue[i]!;
			if (canSwap(ordering, item, other) && may({ type: 'swap', item, other })) return other;
		}
		return undefined;
	}

	if (!party.state && party.status === 'idle' && !party.resume()) goto(resolve('/'));

	$effect(() => {
		if (!adding) addingSince = null;
	});

	const nameOf = (id: string) => s?.guests.find((g) => g.id === id)?.nickname ?? '?';
	const subtitle = (item: QueueItem) =>
		[item.artists.join(', '), s?.settings.showAttribution ? m.added_by({ name: nameOf(item.addedBy) }) : '']
			.filter(Boolean)
			.join(' · ');

	/** A link gets added; anything else is a search. */
	const isLink = $derived(/^(https?:\/\/|www\.|[\w-]+(\.[\w-]+)+\/)/i.test(input.trim()));
	/** The search sent last; done once its results or an error arrive. */
	let searchingFor = $state<string | null>(null);
	const searching = $derived(searchingFor !== null && party.search?.q !== searchingFor && !party.error);
	$effect(() => {
		if (!searching) searchingFor = null;
	});

	function add(e: SubmitEvent) {
		e.preventDefault();
		const text = input.trim();
		if (!text) return;
		if (!isLink) {
			party.search = null;
			searchingFor = text;
			party.send({ t: 'search', q: text });
			return;
		}
		// "youtu.be/…" pasted without its scheme still needs one to be a link.
		addSong(/^https?:\/\//i.test(text) ? text : `https://${text}`);
	}

	function addSong(link: string) {
		party.send({ t: 'add', input: link });
		addingSince = queued;
		input = '';
		party.search = null;
	}

	async function paste() {
		input = await navigator.clipboard.readText().catch(() => input);
	}

	function end() {
		if (confirm(m.end_party_confirm())) party.send({ t: 'end' });
	}
</script>

{#snippet limitSelect(text: string, key: Limit, choices: (number | null)[], show: (n: number) => string, off: string)}
	<label>
		<span class="dim">{text}</span>
		<select value={String(s?.settings[key])} onchange={(e) => setLimit(key, e.currentTarget.value)}>
			{#each choices as n (n)}
				<option value={String(n)}>{n === null ? off : show(n)}</option>
			{/each}
		</select>
	</label>
{/snippet}

{#if party.status === 'ended'}
	<main class="page">
		<p>{party.endReason ? errorText(party.endReason) : m.party_ended()}</p>
		<a href={resolve('/')}>{m.back_home()}</a>
	</main>
{:else if !s}
	<main class="page"><p class="dim">{m.connecting()}</p></main>
{:else if party.me?.pending}
	<main class="page">
		<h1>bye0</h1>
		<p role="status">{m.waiting_approval({ name: party.me.nickname })}</p>
	</main>
{:else}
	<main class="page">
		<header class="row">
			<h1 class="grow">bye0</h1>
			<span class="code">{s.code}</span>
		</header>

		{#if party.status === 'connecting'}
			<p class="dim" role="status">{m.reconnecting()}</p>
		{/if}

		{#if party.isHost && waiting.length}
			<section class="card lobby">
				<h2>{m.lobby_title()} ({waiting.length})</h2>
				{#each waiting as guest (guest.id)}
					<div class="row">
						<p class="grow ellipsis">{guest.nickname}</p>
						<button class="small primary" onclick={() => party.send({ t: 'approve', guestId: guest.id })}>{m.let_in()}</button>
						<button class="small danger" onclick={() => party.send({ t: 'kick', guestId: guest.id })}>{m.turn_away()}</button>
					</div>
				{/each}
			</section>
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
			<input class="grow" type="text" bind:value={input} placeholder={m.add_placeholder()} aria-label={m.add_placeholder()} />
			{#if !input && 'clipboard' in navigator}
				<button type="button" onclick={paste}>{m.add_paste()}</button>
			{:else if isLink}
				<button class="primary" disabled={waitSeconds > 0}>{m.add_action()}</button>
			{:else}
				<button class="primary" disabled={!input.trim() || searching}>{m.search_action()}</button>
			{/if}
		</form>
		{#if searching}
			<p class="dim" role="status">{m.searching()}</p>
		{:else if adding}
			<p class="dim" role="status">{m.adding()}</p>
		{:else if waitSeconds > 0}
			<p class="dim" role="status">{m.add_cooldown_wait({ seconds: waitSeconds })}</p>
		{/if}

		{#if party.search}
			{@const found = party.search}
			<section class="card">
				<div class="row">
					<h2 class="grow">{m.search_title({ q: found.q })}</h2>
					<button class="small" onclick={() => (party.search = null)}>{m.close()}</button>
				</div>
				{#each found.results as r (r.url)}
					<button class="result" disabled={waitSeconds > 0} onclick={() => addSong(r.url)}>
						{#if r.artworkUrl}<img src={r.artworkUrl} alt="" loading="lazy" />{:else}<span class="art"></span>{/if}
						<span class="text">
							<span class="ellipsis">{r.title}</span>
							<span class="dim ellipsis">{[r.artists.join(', '), duration(r.durationMs)].filter(Boolean).join(' · ')}</span>
						</span>
					</button>
				{:else}
					<p class="dim">{m.no_results()}</p>
				{/each}
			</section>
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
			{#each s.queue as item, index (item.id)}
				{@const earlier = swapTarget(index, -1)}
				{@const later = swapTarget(index, 1)}
				<div class="row song">
					<div class="grow">
						<p class="ellipsis">{item.title}</p>
						<p class="dim ellipsis">{subtitle(item)}</p>
					</div>
					{#if earlier || later}
						<button
							class="small"
							aria-label={m.move_earlier()}
							disabled={!earlier}
							onclick={() => earlier && party.send({ t: 'swap', itemId: item.id, otherId: earlier.id })}
						>
							↑
						</button>
						<button
							class="small"
							aria-label={m.move_later()}
							disabled={!later}
							onclick={() => later && party.send({ t: 'swap', itemId: item.id, otherId: later.id })}
						>
							↓
						</button>
					{/if}
					{#if ordering?.usesUpvotes}
						<button
							class="small upvote"
							aria-label={m.upvote()}
							aria-pressed={party.you !== null && Object.hasOwn(item.upvotes, party.you)}
							disabled={item.addedBy === party.you}
							onclick={() => party.send({ t: 'upvote', itemId: item.id })}
						>
							▲ {Object.keys(item.upvotes).length}
						</button>
					{/if}
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
					<label class="row">
						<input
							type="checkbox"
							checked={s.settings.skipCountsOffline}
							onchange={(e) => party.send({ t: 'settings', patch: { skipCountsOffline: e.currentTarget.checked } })}
						/>
						{m.skip_counts_offline()}
					</label>
				{/if}
				<label class="row">
					<input
						type="checkbox"
						checked={s.settings.preferAudio}
						onchange={(e) => party.send({ t: 'settings', patch: { preferAudio: e.currentTarget.checked } })}
					/>
					{m.prefer_audio()}
				</label>
				<label class="row">
					<input
						type="checkbox"
						checked={s.settings.allowCollections}
						onchange={(e) => party.send({ t: 'settings', patch: { allowCollections: e.currentTarget.checked } })}
					/>
					{m.allow_collections()}
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

			<section class="card">
				<h2>{m.limits()}</h2>
				{@render limitSelect(m.max_duration(), 'maxDurationMs', MAX_DURATION_CHOICES, span, m.no_limit())}
				{@render limitSelect(m.max_queued(), 'maxQueuedPerGuest', MAX_QUEUED_CHOICES, String, m.no_limit())}
				{@render limitSelect(m.add_cooldown(), 'addCooldownMs', COOLDOWN_CHOICES, span, m.add_cooldown_off())}
			</section>

			<section class="card">
				<h2>{m.who_can_join()}</h2>
				<label class="row">
					<input
						type="checkbox"
						checked={s.settings.approveJoins}
						onchange={(e) => party.send({ t: 'settings', patch: { approveJoins: e.currentTarget.checked } })}
					/>
					{m.approve_joins()}
				</label>
				<label class="row">
					<input type="checkbox" checked={locked} onchange={(e) => setLocked(e.currentTarget.checked)} />
					{m.lock_party()}
				</label>
				{@render limitSelect(m.auto_lock(), 'autoLockMs', AUTO_LOCK_CHOICES, span, m.auto_lock_off())}
				{#if locksAt}
					<p class="dim">{m.locks_at({ time: locksAt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })}</p>
				{/if}
				<label class="row">
					<input
						type="checkbox"
						checked={s.settings.sameNetwork}
						onchange={(e) => party.send({ t: 'settings', patch: { sameNetwork: e.currentTarget.checked } })}
					/>
					{m.same_network()}
				</label>
				{#if s.settings.sameNetwork}
					<p class="dim">{m.same_network_hint()}</p>
				{/if}
			</section>
		{/if}

		<section class="card">
			<h2>{m.guests()} ({members.length})</h2>
			{#each members as guest (guest.id)}
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
	.result {
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding: 8px;
		text-align: left;
	}
	.result img,
	.result .art {
		flex: none;
		width: 48px;
		height: 48px;
		object-fit: cover;
		border-radius: 6px;
		background: var(--surface);
	}
	.result .text {
		display: grid;
		min-width: 0;
	}
	.confirm,
	.lobby {
		outline: 2px solid var(--accent);
	}
	/* Too many buttons for one line: they drop under the title. */
	.song {
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.song > .grow {
		flex-basis: 50%;
	}
	.upvote {
		white-space: nowrap;
	}
	.upvote[aria-pressed='true'] {
		background: var(--accent);
		color: var(--accent-text);
	}
</style>
