<script lang="ts">
	import { CONFIRM_CHOICES, type QueueItem } from '@bye0/shared';
	import { duration } from '#lib/text.ts';

	let { item, onpick }: { item: QueueItem; onpick: (candidateIndex: number) => void } = $props();

	// YouTube serves a thumbnail for every video at this address; the matching service may know a better one.
	const thumbnail = (videoId: string, url?: string) => url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
</script>

<div class="choices">
	{#each item.candidates.slice(0, CONFIRM_CHOICES) as c, i (i)}
		<button class="choice" aria-pressed={i === item.candidateIndex} onclick={() => onpick(i)}>
			<img src={thumbnail(c.videoId, c.thumbnailUrl)} alt="" loading="lazy" />
			<span class="text">
				<span class="ellipsis">{c.title}</span>
				<span class="dim ellipsis">{[c.channel, duration(c.durationMs)].filter(Boolean).join(' · ')}</span>
			</span>
		</button>
	{/each}
</div>

<style>
	.choices {
		display: grid;
		gap: 8px;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding: 8px;
		border: 2px solid transparent;
		text-align: left;
	}
	.choice[aria-pressed='true'] {
		border-color: var(--accent);
	}
	img {
		flex: none;
		width: 80px;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 6px;
		background: var(--surface);
	}
	.text {
		display: grid;
		min-width: 0;
	}
</style>
