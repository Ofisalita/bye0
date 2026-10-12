<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { CODE_LENGTH, NICKNAME_MAX, PRESETS } from '@bye0/shared';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale, locales, setLocale } from '#lib/paraglide/runtime.js';
	import { party, savedNickname } from '#lib/party.svelte.ts';
	import { errorText, hint, label } from '#lib/text.ts';

	// The QR on the Player view links here with ?code=XXXX.
	const linkedCode = page.url.searchParams.get('code')?.toUpperCase() ?? '';

	let nickname = $state(savedNickname());
	let code = $state(linkedCode);
	let preset = $state('house-party');

	const named = $derived(nickname.trim().length > 0);
	const busy = $derived(party.status === 'connecting');

	// Refreshing or reopening the app drops you back into your party.
	if (!linkedCode && party.status === 'idle') party.resume();

	$effect(() => {
		if (party.state) goto(resolve('/party'));
	});

	function join(e: SubmitEvent) {
		e.preventDefault();
		party.enter({ t: 'join', code, nickname });
	}

	function host(e: SubmitEvent) {
		e.preventDefault();
		party.enter({ t: 'create', nickname, settings: PRESETS.find((p) => p.id === preset)?.settings });
	}
</script>

<main class="page">
	<header>
		<h1>bye0</h1>
		<p class="dim">{m.tagline()}</p>
	</header>

	<label>
		<span class="dim">{m.nickname()}</span>
		<input type="text" bind:value={nickname} maxlength={NICKNAME_MAX} autocomplete="nickname" />
	</label>

	<form class="card" onsubmit={join}>
		<h2>{m.join_title()}</h2>
		<input
			class="code"
			type="text"
			bind:value={code}
			placeholder={m.join_code()}
			aria-label={m.join_code()}
			maxlength={CODE_LENGTH}
			autocapitalize="characters"
			autocomplete="off"
		/>
		<button class="primary" disabled={!named || code.length !== CODE_LENGTH || busy}>{m.join_action()}</button>
	</form>

	{#if !linkedCode}
		<form class="card" onsubmit={host}>
			<h2>{m.host_title()}</h2>
			{#each PRESETS as p (p.id)}
				<label class="preset">
					<input type="radio" bind:group={preset} value={p.id} />
					<span>
						<strong>{label(p.id)}</strong><br />
						<span class="dim">{hint(p.id)}</span>
					</span>
				</label>
			{/each}
			<button disabled={!named || busy}>{m.host_action()}</button>
		</form>
	{/if}

	<label class="row dim">
		{m.language()}
		<select value={getLocale()} onchange={(e) => setLocale(e.currentTarget.value as (typeof locales)[number])}>
			{#each locales as locale (locale)}
				<option>{locale}</option>
			{/each}
		</select>
	</label>
</main>

{#if party.error}
	<p class="toast" role="alert">{errorText(party.error)}</p>
{/if}

<style>
	.code {
		font-size: 1.5rem;
		letter-spacing: 0.4em;
		text-align: center;
		text-transform: uppercase;
	}
	.preset {
		display: flex;
		gap: var(--gap);
		align-items: flex-start;
	}
	select {
		width: auto;
	}
</style>
