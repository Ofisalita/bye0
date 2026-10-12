import { describe, expect, test } from 'bun:test';
import { CONFIRM_CHOICES, CONFIRM_MS, DEFAULT_SETTINGS } from '@bye0/shared';
import { youtubeId } from './matching';
import { Party, type ResolvedTrack } from './party';
import { CODE_GRACE_MS, CODE_ROTATE_MS, PARTY_TTL_MS, Registry, WRONG_CODE_WINDOW_MS, WRONG_CODES_PER_WINDOW } from './registry';

const track = (title: string, candidates = 1, durationMs = 180_000): ResolvedTrack => ({
	title,
	artists: ['x'],
	durationMs,
	candidates: Array.from({ length: candidates }, (_, i) => ({ videoId: `${title}-${i}`, title, channel: 'x', durationMs }))
});

function setup(settings = {}) {
	const party = new Party(0, settings);
	const id = (token: string, role: 'host' | 'guest' = 'guest') => {
		const g = party.join(token, token, 0, role);
		if (typeof g === 'string') throw new Error(g);
		party.connect(`conn-${token}`, g.id, 0);
		return g.id;
	};
	return { party, host: id('host', 'host'), ana: id('ana'), beto: id('beto') };
}

describe('Party', () => {
	test('nothing plays until the host starts; then the queue drains in order', () => {
		const { party, host, ana, beto } = setup();
		party.add(ana, track('a1'), 1);
		party.add(ana, track('a2'), 2);
		party.add(beto, track('b1'), 3);
		expect(party.nowPlaying).toBeNull();
		expect(party.start(ana, 4)).toBe('not-allowed');
		expect(party.start(host, 4)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('a1');
		// round-robin: beto's first goes before ana's second
		expect(party.state(5).queue.map((i) => i.title)).toEqual(['b1', 'a2']);
	});

	test('a song added to an empty started party plays right away', () => {
		const { party, host, ana } = setup();
		party.start(host, 0);
		party.add(ana, track('a1'), 1);
		expect(party.nowPlaying?.item.title).toBe('a1');
	});

	test('democracy: votes accumulate and reset with the next song', () => {
		const { party, host, ana, beto } = setup({ skipThreshold: 0.6 }); // 3 connected → 2 votes
		party.start(host, 0);
		party.add(ana, track('a1'), 1);
		party.add(ana, track('a2'), 2);
		expect(party.skip(ana, 3)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('a1');
		expect(party.skip(ana, 3)).toBe('already-voted');
		expect(party.skip(beto, 4)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('a2');
		expect(party.nowPlaying?.skipVotes).toEqual([]);
	});

	test('democracy: a guest going offline lowers the bar, unless offline guests count', () => {
		for (const skipCountsOffline of [false, true]) {
			const { party, host, ana } = setup({ skipThreshold: 0.6, skipCountsOffline }); // 3 guests → 2 votes
			party.start(host, 0);
			party.add(ana, track('a1'), 1);
			party.add(ana, track('a2'), 2);
			party.disconnect('conn-beto'); // 2 connected → 2 votes; offline counted → still 2
			party.disconnect('conn-host'); // 1 connected → 1 vote; offline counted → still 2
			expect(party.skip(ana, 3)).toBeNull();
			expect(party.nowPlaying?.item.title).toBe(skipCountsOffline ? 'a1' : 'a2');
		}
		const { party, host } = setup();
		expect(party.patchSettings({ skipCountsOffline: 'yes' as unknown as boolean }, host)).toBe('bad-request');
	});

	test('guards: duration and per-guest limit', () => {
		const { party, ana } = setup({ maxDurationMs: 60_000, maxQueuedPerGuest: 1 });
		expect(party.add(ana, track('long'), 1)).toBe('too-long');
		expect(party.add(ana, track('ok', 1, 30_000), 1)).toBeNull();
		expect(party.add(ana, track('ok2', 1, 30_000), 1)).toBe('queue-limit');
	});

	test('guards: a live stream never ends, so any duration limit rejects it', () => {
		const live = { ...track('live', 1, 0), isLive: true };
		const { party, host, ana } = setup();
		expect(party.add(ana, live, 1)).toBe('too-long');
		party.patchSettings({ maxDurationMs: null }, host);
		expect(party.add(ana, live, 2)).toBeNull();
	});

	test('cooldown: a guest waits between songs; failed adds and other guests are not held up', () => {
		const { party, ana, beto } = setup({ addCooldownMs: 30_000, maxDurationMs: 60_000 });
		expect(party.add(ana, track('long'), 0)).toBe('too-long');
		expect(party.add(ana, track('a1', 1, 30_000), 1)).toBeNull();
		expect(party.canAdd(ana, 30_000)).toBe('cooldown');
		expect(party.add(ana, track('a2', 1, 30_000), 30_000)).toBe('cooldown');
		expect(party.add(beto, track('b1', 1, 30_000), 30_000)).toBeNull();
		expect(party.add(ana, track('a2', 1, 30_000), 30_001)).toBeNull();
		expect(party.state(30_002).guests.find((g) => g.id === ana)?.lastAddedAt).toBe(30_001);
	});

	test('full democracy: the host cannot skip, remove or bump alone', () => {
		const { party, host, ana, beto } = setup({ skipThreshold: 1 }); // 3 connected → 3 votes
		party.start(host, 0);
		party.add(ana, track('a1'), 1);
		party.add(ana, track('a2'), 2);
		const a2 = party.state(3).queue[0]!;
		expect(party.remove(host, a2.id, 3)).toBe('not-allowed');
		expect(party.bump(host, a2.id, 3)).toBe('not-allowed');
		expect(party.skip(host, 3)).toBeNull();
		expect(party.skip(host, 3)).toBe('already-voted');
		expect(party.skip(ana, 3)).toBeNull();
		expect(party.nowPlaying).toMatchObject({ item: { title: 'a1' }, skipVotes: [host, ana] });
		expect(party.skip(beto, 4)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('a2');
	});

	test('presidential democracy: the host skips alone, guests still vote', () => {
		const { party, host, ana } = setup({ governance: 'presidential-democracy', skipThreshold: 1 });
		party.start(host, 0);
		party.add(ana, track('a1'), 1);
		party.add(ana, track('a2'), 2);
		expect(party.skip(ana, 3)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('a1');
		expect(party.skip(host, 4)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('a2');
	});

	test('bump puts a song first; under presidential democracy only the host may', () => {
		const { party, host, ana, beto } = setup({ governance: 'presidential-democracy' });
		party.add(ana, track('a1'), 1);
		party.add(beto, track('b1'), 2);
		const b1 = party.state(3).queue[1]!;
		expect(party.bump(beto, b1.id, 3)).toBe('not-allowed');
		expect(party.bump(host, b1.id, 3)).toBeNull();
		expect(party.state(4).queue.map((i) => i.title)).toEqual(['b1', 'a1']);
	});

	test('anarchy: a guest skips at once and removes or bumps anyone\'s song', () => {
		const { party, host, ana, beto } = setup({ governance: 'anarchy', ordering: 'fifo' });
		party.start(host, 0);
		for (const [i, title] of ['h1', 'h2', 'h3', 'h4'].entries()) party.add(host, track(title), i);
		expect(party.skip(ana, 5)).toBeNull();
		expect(party.nowPlaying?.item.title).toBe('h2');
		const [h3, h4] = party.state(6).queue;
		expect(party.remove(beto, h3!.id, 6)).toBeNull();
		expect(party.bump(ana, h4!.id, 6)).toBeNull();
		expect(party.state(7).queue.map((i) => i.title)).toEqual(['h4']);
	});

	test('confirmation: the adder picks within the window, the host any time', () => {
		const { party, host, ana, beto } = setup();
		party.add(ana, { ...track('sure', 3), needsConfirmation: false }, 0);
		party.add(ana, { ...track('one-choice', 1), needsConfirmation: true }, 0);
		party.add(ana, { ...track('unsure', 5), needsConfirmation: true }, 1_000);
		const byTitle = (title: string) => party.state(1_000).queue.find((i) => i.title === title);
		const [sure, oneChoice, unsure] = ['sure', 'one-choice', 'unsure'].map(byTitle);
		expect(sure!.confirmBy).toBeUndefined();
		expect(oneChoice!.confirmBy).toBeUndefined();
		expect(unsure!.confirmBy).toBe(1_000 + CONFIRM_MS);

		expect(party.pick(beto, unsure!.id, 1, 2_000)).toBe('not-allowed');
		expect(party.pick(ana, unsure!.id, CONFIRM_CHOICES, 2_000)).toBe('bad-request'); // only the top 3
		expect(party.pick(ana, unsure!.id, 1.5, 2_000)).toBe('bad-request');
		expect(party.pick(ana, sure!.id, 1, 2_000)).toBe('not-allowed'); // nothing to confirm
		expect(party.pick(ana, unsure!.id, 2, 2_000)).toBeNull();
		expect(unsure!.candidateIndex).toBe(2);
		expect(unsure!.confirmBy).toBeUndefined();
		expect(party.pick(ana, unsure!.id, 0, 2_001)).toBe('not-allowed'); // already settled

		party.add(beto, { ...track('late', 3), needsConfirmation: true }, 0);
		const late = party.state(0).queue.find((i) => i.title === 'late')!;
		expect(party.pick(beto, late.id, 1, CONFIRM_MS + 1)).toBe('not-allowed'); // too late: the top one stays

		expect(party.pick(host, late.id, 1, 60_000)).toBeNull();
		expect(party.pick(host, sure!.id, 2, 60_000)).toBeNull();
	});

	test('picking another version of the playing song restarts it', () => {
		const { party, host, ana } = setup();
		party.start(host, 0);
		party.add(ana, { ...track('a1', 3), needsConfirmation: true }, 1);
		party.claimPlayer('conn-host');
		party.heartbeat('conn-host', party.nowPlaying!.item.id, 4_000, false, 5_000);
		expect(party.pick(ana, party.nowPlaying!.item.id, 1, 6_000)).toBeNull();
		expect(party.nowPlaying).toMatchObject({ item: { candidateIndex: 1 }, positionMs: 0, positionAt: 6_000 });
	});

	test('upvotes: one per guest, taken back by voting again, never on your own song', () => {
		const { party, host, ana, beto } = setup({ ordering: 'vote-ranked' });
		party.add(ana, track('a1'), 1);
		party.add(beto, track('b1'), 2);
		const titles = () => party.state(9).queue.map((i) => i.title);
		const [a1, b1] = party.state(3).queue;
		expect(party.upvote(beto, b1!.id, 3)).toBe('not-allowed');
		expect(party.upvote(ana, 'nope', 3)).toBe('bad-request');
		expect(party.upvote(ana, b1!.id, 3)).toBeNull();
		expect(party.upvote(host, b1!.id, 4)).toBeNull();
		expect(b1!.upvotes).toEqual({ [ana]: 3, [host]: 4 });
		expect(titles()).toEqual(['b1', 'a1']);
		expect(party.upvote(ana, b1!.id, 5)).toBeNull();
		expect(party.upvote(host, b1!.id, 5)).toBeNull();
		expect(b1!.upvotes).toEqual({});
		expect(titles()).toEqual(['a1', 'b1']);

		// A kicked guest's votes leave with them.
		party.upvote(beto, a1!.id, 6);
		party.upvote(ana, b1!.id, 6);
		party.upvote(host, b1!.id, 6);
		party.kick(host, ana);
		expect(party.state(9).queue).toMatchObject([{ title: 'b1', upvotes: { [host]: 6 } }]);
	});

	test('player errors fall through candidates, then skip', () => {
		const { party, host, ana } = setup();
		party.start(host, 0);
		party.add(ana, track('a1', 2), 1);
		party.add(ana, track('a2'), 2);
		const itemId = party.nowPlaying!.item.id;
		expect(party.playerError('conn-host', itemId, 3)).toBe(false); // not the player yet
		expect(party.claimPlayer('conn-ana')).toBe('not-allowed');
		expect(party.claimPlayer('conn-host')).toBeNull();
		expect(party.playerError('conn-host', itemId, 3)).toBe(true);
		expect(party.nowPlaying?.item.candidateIndex).toBe(1);
		expect(party.playerError('conn-host', itemId, 4)).toBe(true);
		expect(party.nowPlaying?.item.title).toBe('a2');
	});

	test('handoff: position survives the player dropping, a co-host can take over', () => {
		const { party, host, ana } = setup();
		party.start(host, 0);
		party.add(ana, track('a1'), 1);
		party.claimPlayer('conn-host');
		party.heartbeat('conn-host', party.nowPlaying!.item.id, 42_000, false, 50_000);
		party.disconnect('conn-host');
		expect(party.state(51_000).playerId).toBeNull();
		expect(party.nowPlaying).toMatchObject({ positionMs: 42_000, positionAt: 50_000 });
		party.setRole(host, ana, 'cohost');
		expect(party.claimPlayer('conn-ana')).toBeNull();
		expect(party.state(52_000).playerId).toBe(ana);
	});

	test('approve joins: newcomers wait in the lobby and do not count until let in', () => {
		const { party, host, ana, beto } = setup({ skipThreshold: 1 });
		expect(party.patchSettings({ approveJoins: true }, host)).toBeNull();
		expect(party.isPending(ana)).toBe(false); // already in
		const late = party.join('cata', 'cata', 1);
		if (typeof late === 'string') throw new Error(late);
		party.connect('conn-cata', late.id, 1);
		expect(late.pending).toBe(true);
		expect((party.join('cata', 'cata again', 2) as { pending?: boolean }).pending).toBe(true); // rejoining doesn't skip the lobby

		party.start(host, 2);
		party.add(ana, track('a1'), 3);
		party.add(ana, track('a2'), 3);
		party.skip(host, 4);
		party.skip(ana, 4);
		expect(party.skip(beto, 4)).toBeNull(); // 3 of 3: cata in the lobby doesn't raise the bar
		expect(party.nowPlaying?.item.title).toBe('a2');

		expect(party.approve(ana, late.id)).toBe('not-allowed');
		expect(party.approve(host, late.id)).toBeNull();
		expect(party.isPending(late.id)).toBe(false);
		expect(party.approve(host, late.id)).toBe('bad-request'); // already in
	});

	test('approve joins: turning it off lets everyone waiting in', () => {
		const { party, host } = setup();
		party.patchSettings({ approveJoins: true }, host);
		const g = party.join('cata', 'cata', 1) as { id: string };
		expect(party.isPending(g.id)).toBe(true);
		expect(party.patchSettings({ approveJoins: false }, host)).toBeNull();
		expect(party.isPending(g.id)).toBe(false);
	});

	test('lock: no new guests, but anyone already in can come back', () => {
		const { party, host } = setup();
		expect(party.patchSettings({ locked: true }, host)).toBeNull();
		expect(party.join('cata', 'cata', 1)).toBe('locked');
		expect(party.join('ana', 'ana', 1)).toMatchObject({ nickname: 'ana' });
		party.patchSettings({ locked: false }, host);
		expect(party.join('cata', 'cata', 2)).toMatchObject({ nickname: 'cata' });
	});

	test('auto-lock counts from when the party was created', () => {
		const { party, host } = setup({ autoLockMs: 60_000 }); // created at 0
		expect(party.join('cata', 'cata', 59_999)).toMatchObject({ nickname: 'cata' });
		expect(party.join('dani', 'dani', 60_000)).toBe('locked');
		expect(party.state(60_000).createdAt).toBe(0);
		party.patchSettings({ autoLockMs: null }, host);
		expect(party.join('dani', 'dani', 60_001)).toMatchObject({ nickname: 'dani' });
		expect(party.patchSettings({ autoLockMs: 0 }, host)).toBe('bad-request');
	});

	test('same network: newcomers must share a network the host connected from', () => {
		const { party, host } = setup();
		party.patchSettings({ sameNetwork: true }, host);
		party.connect('conn-host-wifi', host, 1, '203.0.113.7');
		party.connect('conn-host-v6', host, 1, '2001:db8:1:2::9');
		expect(party.join('cata', 'cata', 2, 'guest', '203.0.113.7')).toMatchObject({ nickname: 'cata' });
		expect(party.join('dani', 'dani', 2, 'guest', '2001:db8:1:2::42')).toMatchObject({ nickname: 'dani' });
		expect(party.join('eli', 'eli', 2, 'guest', '198.51.100.1')).toBe('other-network');
		expect(party.join('ana', 'ana', 2, 'guest', '198.51.100.1')).toMatchObject({ nickname: 'ana' }); // already in
		party.patchSettings({ sameNetwork: false }, host);
		expect(party.join('eli', 'eli', 3, 'guest', '198.51.100.1')).toMatchObject({ nickname: 'eli' });
	});

	test('a snapshot survives JSON and restores the same party, minus connections', () => {
		const { party, host, ana, beto } = setup({ ordering: 'fifo' });
		party.patchSettings({ sameNetwork: true }, host);
		party.connect('conn-host-2', host, 0, '203.0.113.7');
		party.start(host, 1);
		party.add(ana, track('a1', 2), 2);
		party.add(beto, track('b1'), 3);
		party.add(ana, track('a2'), 4);
		party.upvote(beto, party.state(5).queue.find((i) => i.title === 'a2')!.id, 5);
		party.claimPlayer('conn-host');
		party.heartbeat('conn-host', party.nowPlaying!.item.id, 42_000, false, 6);
		party.skip(ana, 7);
		party.kick(host, beto);

		const restored = Party.restore(JSON.parse(JSON.stringify(party.snapshot())));
		const before = party.state(8);
		const after = restored.state(8);
		expect(after).toEqual({
			...before,
			guests: before.guests.map((g) => ({ ...g, connected: false })),
			playerId: null
		});
		expect(restored.guestByToken('ana')?.id).toBe(ana);
		expect(restored.join('beto', 'beto', 9)).toBe('banned');
		expect(restored.join('cata', 'cata', 9, 'guest', '198.51.100.1')).toBe('other-network');
		expect(restored.join('cata', 'cata', 9, 'guest', '203.0.113.7')).toMatchObject({ nickname: 'cata' });
	});

	test('a player coming back only takes the role if nobody else has it', () => {
		const { party, host } = setup();
		party.connect('conn-host-tv', host, 0);
		expect(party.claimPlayer('conn-host', false)).toBeNull();
		expect(party.claimPlayer('conn-host-tv', false)).toBe('not-allowed');
		expect(party.claimPlayer('conn-host-tv')).toBeNull(); // an explicit tap still takes over
	});

	test('collections: queued as stubs in album order, within the limits', () => {
		const { party, host, ana } = setup({ ordering: 'fifo', maxDurationMs: 300_000, maxQueuedPerGuest: 4 });
		party.add(ana, track('single'), 0);
		const album = ['t1', 't2', 'long', 't3', 't4', 't5'].map((title) => ({
			title,
			artists: ['x'],
			durationMs: title === 'long' ? 600_000 : 200_000,
			source: `https://open.spotify.com/track/${title}`
		}));
		expect(party.addCollection(ana, album, 1)).toBeNull();
		// 1 single + 3 of the album fill ana's 4; the long one is left out
		expect(party.state(2).queue.map((i) => [i.title, i.source !== undefined])).toEqual([
			['single', false],
			['t1', true],
			['t2', true],
			['t3', true]
		]);
		expect(party.addCollection(ana, album, 2)).toBe('queue-limit');
		expect(party.stubsAhead(2, 3).map((i) => i.title)).toEqual(['t1']);
		party.patchSettings({ maxQueuedPerGuest: null }, host);
		expect(party.addCollection(ana, [album[2]!], 4)).toBe('too-long');
	});

	test('collections: stubs wait for their lookup; a failed one just leaves', () => {
		const { party, host, ana, beto } = setup({ ordering: 'fifo' });
		const stub = (title: string) => ({ title, artists: [], durationMs: 0, source: `https://x/${title}` });
		party.addCollection(ana, [stub('s1'), stub('s2')], 0);
		party.add(beto, track('b1'), 5);
		party.start(host, 6);
		expect(party.nowPlaying?.item.title).toBe('b1'); // s1 and s2 aren't looked up yet
		const [s1, s2] = party.state(7).queue;
		expect(party.fillStub(s2!.id, 'unresolvable', 8)).toBe(true);
		expect(party.fillStub(s1!.id, { ...track('S1', 2), needsConfirmation: true }, 9)).toBe(true);
		const [filled, ...rest] = party.state(9).queue;
		expect(rest).toEqual([]);
		expect(filled).toMatchObject({ title: 'S1', candidates: [{}, {}] });
		expect(filled!.source).toBeUndefined();
		expect(filled!.confirmBy).toBeUndefined(); // album songs never prompt
		expect(party.fillStub(s1!.id, track('again'), 10)).toBe(false); // already looked up

		party.ended('conn-host', party.nowPlaying!.item.id, 11); // not the player: ignored
		party.claimPlayer('conn-host');
		party.ended('conn-host', party.nowPlaying!.item.id, 12);
		expect(party.nowPlaying?.item.title).toBe('S1');
	});

	test('collections: a stub looked up while nothing plays starts right away', () => {
		const { party, host, ana } = setup();
		party.addCollection(ana, [{ title: 's1', artists: [], durationMs: 0, source: 'https://x/s1' }], 0);
		party.start(host, 1);
		expect(party.nowPlaying).toBeNull();
		party.fillStub(party.state(2).queue[0]!.id, track('S1'), 2);
		expect(party.nowPlaying?.item.title).toBe('S1');
	});

	test('kick bans the device and drops its songs', () => {
		const { party, host, ana } = setup();
		party.add(ana, track('a1'), 1);
		expect(party.kick(ana, host)).toBe('not-allowed');
		expect(party.kick(host, ana)).toEqual(['conn-ana']);
		expect(party.state(2).queue).toEqual([]);
		expect(party.join('ana', 'ana again', 3)).toBe('banned');
	});

	test('settings: host only, validated', () => {
		const { party, host, ana } = setup();
		expect(party.patchSettings({ ordering: 'fifo' }, ana)).toBe('not-allowed');
		expect(party.patchSettings({ ordering: 'nope' }, host)).toBe('bad-request');
		expect(party.patchSettings({ ordering: 'fifo', governance: 'dictatorship' }, host)).toBeNull();
		expect(party.settings.ordering).toBe('fifo');
		// Names every plain object inherits must not count as strategies.
		for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
			expect(party.patchSettings({ ordering: id }, host)).toBe('bad-request');
			expect(party.patchSettings({ governance: id }, host)).toBe('bad-request');
		}
		expect(party.patchSettings({ skipThreshold: '0.5' as unknown as number }, host)).toBe('bad-request');
		expect(party.patchSettings({ addCooldownMs: -1 }, host)).toBe('bad-request');
		expect(party.patchSettings({ addCooldownMs: 30_000 }, host)).toBeNull();
		expect(party.patchSettings({ addCooldownMs: null }, host)).toBeNull();
		expect(party.patchSettings({ preferAudio: 'yes' as unknown as boolean }, host)).toBe('bad-request');
		expect(party.patchSettings({ preferAudio: true }, host)).toBeNull();
	});

	test('a party created with bogus settings falls back to the defaults and still works', () => {
		const party = new Party(0, { ordering: 'constructor', governance: 'toString' });
		expect(party.settings).toEqual(DEFAULT_SETTINGS);
		expect(() => party.state(1)).not.toThrow();
	});
});

describe('Registry', () => {
	test('codes rotate with a grace period, stale parties expire', () => {
		const reg = new Registry();
		const party = reg.create(0);
		const first = party.code;
		expect(reg.byCode(first.toLowerCase(), 1)).toBe(party);

		expect(reg.tick(CODE_ROTATE_MS).rotated).toEqual([party]);
		expect(party.code).not.toBe(first);
		expect(reg.byCode(first, CODE_ROTATE_MS + 1)).toBe(party);
		expect(reg.byCode(first, CODE_ROTATE_MS + CODE_GRACE_MS + 1)).toBeUndefined();
		expect(reg.byCode(party.code, CODE_ROTATE_MS + CODE_GRACE_MS + 1)).toBe(party);

		expect(reg.tick(PARTY_TTL_MS + 1).expired).toEqual([party]);
		expect(reg.get(party.id)).toBeUndefined();
	});

	test('restore puts a party back with its current and grace-period codes', () => {
		const reg = new Registry();
		const party = reg.create(0);
		const first = party.code;
		reg.tick(CODE_ROTATE_MS);
		const again = new Registry();
		again.restore(Party.restore(JSON.parse(JSON.stringify(party.snapshot()))));
		expect(again.byCode(party.code, CODE_ROTATE_MS + 1)?.id).toBe(party.id);
		expect(again.byCode(first, CODE_ROTATE_MS + 1)?.id).toBe(party.id);
		again.tick(CODE_ROTATE_MS + CODE_GRACE_MS + 1);
		expect(again.byCode(first, CODE_ROTATE_MS + CODE_GRACE_MS + 2)).toBeUndefined();
	});

	test('join: a whole party may join from one IP, wrong codes from it are limited', () => {
		const reg = new Registry();
		const party = reg.create(0);
		const ip = '203.0.113.7';
		for (let i = 0; i < 3 * WRONG_CODES_PER_WINDOW; i++) expect(reg.join(party.code, ip, 1)).toBe(party);

		for (let i = 0; i < WRONG_CODES_PER_WINDOW; i++) expect(reg.join('XXXX', ip, 2)).toBe('bad-code');
		expect(reg.join(party.code, ip, 3)).toBe('rate-limited');
		expect(reg.join(party.code, '198.51.100.1', 3)).toBe(party);

		// The window starts at the first wrong code and doesn't slide.
		expect(reg.join(party.code, ip, 2 + WRONG_CODE_WINDOW_MS)).toBe(party);
	});
});

test('youtubeId', () => {
	const id = 'FGBhQbmPwH8';
	for (const url of [
		`https://www.youtube.com/watch?v=${id}&t=10s`,
		`https://music.youtube.com/watch?v=${id}&si=abc`,
		`https://youtu.be/${id}?si=abc`,
		`https://m.youtube.com/shorts/${id}`,
		`https://www.youtube.com/embed/${id}`
	])
		expect(youtubeId(url)).toBe(id);
	for (const bad of ['one more time', 'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV', 'https://youtube.com/watch?v=short'])
		expect(youtubeId(bad)).toBeNull();
});
