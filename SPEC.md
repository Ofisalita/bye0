# bye0 — Project Definition (v1)

> Pronounced "vinyl". Defined 2026-10-11 through a Q&A session. Every constraint below was checked against
> docs or live API calls on that date; re-verify anything marked **(verify)** before relying on it.

## 1. One-liner

A zero-install web app that lets everyone at a party queue songs **from whatever streaming service they use**
(by pasting/sharing a link or searching) onto **one shared player**, with host-selectable rules for how the queue
is ordered and how disputes (skips, vetoes) are settled.

## 2. Scope decisions

| Topic | Decision |
|---|---|
| Audience | Friends now, possibly public later. v1 uses **only official/keyless-public APIs for playback**, so going public later doesn't need a rewrite of the player. |
| Playback (v1) | **YouTube only**, via the official IFrame Player API, in a browser. Spotify / YT Music / Apple / Deezer / Tidal links are *accepted* and converted to a YouTube video. |
| Spotify audio | **Not in v1.** Roadmap item: a desktop/Pi "power host" using go-librespot (unofficial, against Spotify ToS, Premium only). |
| Spotify API key | **None.** Spotify links are resolved without it (see [nidol](https://github.com/Ofisalita/nidol), the matching service). |
| Host device | **Any browser; phones first-class.** Web app only — no native apps in v1. |
| Guests | Web page via QR / 4-letter code. Nickname only, no accounts. |
| Persistence | **Ephemeral.** A party's data is deleted when it ends (with a TTL safety net). |
| Languages | Spanish + English from day one. |
| License | WTFPL. |
| Deploy | Docker containers on our own VPS via Coolify. |

### Why not Spotify playback / Spotify API? (facts)

- **Spotify Developer Policy III.5:** "Do not create any product or service which is integrated with streams or
  content from another service." A Spotify + YouTube fallback queue is exactly this.
  III.7 also bans "segue, mix, re-mix, or overlap" (no crossfade/auto-mix), and IV.2 bans commercial use.
  ([policy](https://developer.spotify.com/policy))
- **Development Mode since Feb 2026:** a 5-user allowlist, the app owner must have Premium, search is capped at 10
  results, batch `GET /tracks` was removed. Extended quota requires a registered org with ≥250k MAU.
  ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide),
  [TechCrunch](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/))
- **Competitor baseline:** Spotify Jam already does a free-to-join, Premium-hosted, Spotify-only shared queue.
  bye0's edge is *multi-platform input* + *game-like governance*.
  ([Jam support](https://support.spotify.com/ie/article/jam/))

### Phone-host reality (why web-only v1 means YouTube-only)

- librespot/go-librespot are native programs (Linux/macOS/Windows/Pi). They can't run in a browser, and no
  supported iOS/Android build exists. ([go-librespot](https://github.com/devgianlu/go-librespot))
- YouTube embeds must stay **visible (≥200×200 px) with nothing overlaid** on them
  ([Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)).
  On phones that means **screen on, tab in front**. Use the Screen Wake Lock API to keep it awake.
- iOS Safari requires a user gesture before media plays ([WebKit bug 190794](https://bugs.webkit.org/show_bug.cgi?id=190794)).
  The host taps "Start party" once; **whether later tracks auto-advance without another tap on iOS is unverified.
  Test this first.** Locked-screen playback is assumed to stop.
- YouTube ads will play in the embed and **can't be skipped from code**.

## 3. Architecture

```
┌────────────── Browsers (SvelteKit app, one codebase, 3 views) ──────────────┐
│  Guest view        Host remote view        Player/Display view               │
│  (add, vote,       (settings, approve,     (YouTube IFrame + queue rail      │
│   minigames)        QTE override, kick)     + join QR/code)                  │
└───────────────▲──────────────────▲───────────────────▲───────────────────────┘
                │ WebSocket        │                   │
        ┌───────┴──────────────────┴───────────────────┴──────┐
        │  Room server (TypeScript, Bun)                       │
        │  - authoritative party state (queue, votes, modes)   │
        │  - strategy engine (ordering + governance)           │
        │  - playback timeline (for host handoff)              │
        │  - gatekeeping, rate limits, Web Push (VAPID)        │
        └───────┬──────────────────────────────┬───────────────┘
                │ HTTP                         │
        ┌───────┴────────────┐         ┌───────┴───────┐
        │ Matching service   │         │ Redis (TTL'd  │
        │ (Python, own repo) │         │ party state)  │
        └────────────────────┘         └───────────────┘
```

- **The server owns all state.** Clients render it and send intents; the server validates against the active
  modes and broadcasts the result.
- **Player = whichever device runs the Player view.** If a TV/laptop opens the Player view, it becomes the player
  and the host's phone becomes a remote. Otherwise the host's phone is the player.
- **Host handoff:** the player sends position heartbeats (every ~2 s). If it disconnects, an approved co-host device
  can take over the Player role and `seekTo(lastPosition + elapsed)`. Target: resume in under 10 s.
- **Shared TypeScript types / strategy code** between server and client, so the client can show a predicted
  queue order immediately. The server's result always wins.
- **i18n:** Paraglide (SvelteKit's `sv add paraglide`) or similar **(verify the current recommended option)**.

### Player edge cases the matching layer must cover

YouTube IFrame `onError` codes: `2` bad param, `5` HTML5 player error, `100` removed/private,
`101`/`150` **embedding disabled by owner**. On these errors the player asks for the next candidate from the
matching result and skips forward automatically. Newer embeds also fail without an HTTP Referer, so always serve
the Player view over http(s), never `file://`.

## 4. Party lifecycle & UX

### Host: first minute
1. Open bye0 → **pick a preset** (one tap) → the party is live and the QR + code are shown.
   - Example presets: *Chill dinner* (FIFO + Dictatorship), *House party* (Round-robin + Democracy),
     *Game night* (Hot ranking + Ludocracy), *Chaos* (Shuffle + Anarchy).
   - "Advanced" exposes every ordering / governance / guard / gatekeeping toggle.
2. Tap **Start** (this tap is the gesture iOS requires before audio).

### Guest: join in under 15 s
Scan QR (or type the 4-letter code) → enter a nickname → (wait for approval, if the host enabled it) → home screen.

**Guest home:** now playing at the top, an **add bar always visible** (paste link / search), queue below with voting.

### Adding songs
- **Paste box**, **"Paste from clipboard" button** (Safari asks for permission on each read), **in-app search**.
- **Android:** the installed PWA registers as a **Web Share Target**, so "Share → bye0" works from the Spotify/YT
  Music apps. **iOS Safari doesn't support Web Share Target**, so we publish an **iOS Shortcut** that shows up in
  the share sheet and posts the link to the current party.

### Match confirmation ("QTE")
When the matching service returns `needsConfirmation`:
1. The **guest who added it** gets a 10 s prompt with the top 3 candidates (artwork, title, channel, duration).
2. The **host can override** at any time.
3. If nobody picks within 10 s, the top candidate is used automatically.

### Display / Player view
YouTube player + side rail (up next, join QR/code, live votes and minigames), never overlaying the video.
Two layouts the host can switch between: **Video + side rail** and **Small video + big queue**. Portrait phones
stack it vertically.

### Notifications
In-page banner/vibration, plus **Web Push** ("your song is next"). Push works on Android browsers; **on iOS it only
works if the guest added bye0 to the Home Screen (iOS 16.4+)**.

### Attribution
Nicknames are shown on queue items by default. The host can toggle them off (and Blind-queue-style modes force
them off).

### Visual identity
Clean modern default UI, **built on a theming layer (CSS custom properties / design tokens)** so Winamp-style skins
can drop in later without rewriting components.

## 5. Gatekeeping & guards (all host-toggleable)

| Control | Default | Notes |
|---|---|---|
| Rotating join code | **ON** | QR + 4-letter code from an unambiguous alphabet (~20 symbols, about 160k combos). Rotates every few minutes, with a short grace period for the previous code. Rate-limit join attempts per IP. |
| Host approves joins | off | Each new nickname waits in a lobby. |
| Lock room | off | Manual, or auto-lock after N minutes. |
| Kick / ban | always available | A ban is tied to the device token (localStorage). With nickname-only identity a determined person can get around it by clearing storage; the rotating code is the real defence. |
| Same-network check | off | Heuristic: compare the public IPv4, or the IPv6 /64 prefix, with the host's. Fails for guests on mobile data and some VPN/IPv6 setups. |
| Max song duration | host sets | Blocks 10-hour loop videos. |
| Per-guest limits | host sets | Max queued songs per guest; cooldown between adds. |

## 6. Strategy engine (ordering × governance)

Two independent, pluggable axes, chosen by the host and **switchable mid-party**:

```ts
interface OrderingStrategy {      // decides what plays next
  id: string
  order(queue: QueueItem[], ctx: PartyContext): QueueItem[]
}
interface GovernanceMode {        // decides who can skip/remove/bump/veto and how disputes resolve
  id: string
  handle(intent: Intent, ctx: PartyContext): Resolution   // may start a vote, minigame, lottery…
}
interface Modifier {              // layered on top of any governance mode
  id: string
  wrap(next: GovernanceMode['handle']): GovernanceMode['handle']
}
```

**Build order:** get the engine working end-to-end with **Round-robin + FIFO** and **Dictatorship + Democracy**
first, then add the rest one module at a time.

### v1 catalog (all planned for v1)

**Ordering:** Round-robin per guest · FIFO · Vote-ranked · Hot ranking (votes decay over time, Hacker-News-style)
· Weighted fair (guests with more songs played fall back) · Shuffle · Song battle (two queued songs head-to-head,
the winner plays).

**Governance:** Dictatorship (host only) · Democracy (vote-skip at a configurable threshold of active guests;
upvotes) · Ludocracy (disputes settled by a ~10 s minigame) · Sortition (a random guest picks next / vetoes) ·
Monarchy (a "DJ crown" rotates every N songs) · Auction (points earned by attendance/upvotes, spent to bump) ·
Anarchy (anyone skips instantly).

**Modifiers:** Veto tokens (N per guest per night) · Immunity (nobody can veto the song that's currently playing).

**Ludocracy minigames:** Tap race (validate tap rate on the server) · Reaction duel (measure on the device, send the
result, so network lag doesn't decide it) · Rock-paper-scissors · Song trivia (needs release year etc. from the
matching service).

### Roadmap catalog
Newcomer boost · Length balance · Decade/era flow (MusicBrainz release dates) · Quadratic voting · Ranked-choice /
approval voting · Jury (3 random guests rule) · Coup (supermajority overthrows the monarch/dictator) · Hot potato.

### Idea pool (not decided)
Blind queue (guess who added it) · Theme rounds · Team battle · Encore (top song replays at the end) · Survivor
(bottom-voted song eliminated every N minutes).

**Not feasible:** energy/genre-flow ordering. Spotify's audio features are gone for new apps, and AcousticBrainz
shut down in 2022 (only static dumps remain).

## 7. v1 "done" = all of these

1. **Real party test:** 3+ hours, 8+ guests, phone host, no manual restarts.
2. **Join in under 15 s:** first-time guest, QR scan → first song added.
3. **Match accuracy ≥95%:** on a fixed test set of pasted Spotify / YT Music links (owned by the matching service).
4. **Host handoff:** kill the player tab → a co-host resumes at the right position within 10 s.

## 8. Roadmap (post-v1, in dependency order)

1. **Skins** — on top of the v1 theming layer.
2. **Visualizer** — on a web host it **must use the microphone** (`getUserMedia` + Web Audio `AnalyserNode`),
   because the browser can't read YouTube/DRM audio.
3. **Auto-fill** — learn from what's been played *in the current party* (parties are ephemeral). Candidate sources:
   ListenBrainz / Last.fm similar-artist/track APIs **(verify terms and limits)**. Spotify recommendations aren't
   available.
4. **Auto-mix / crossfade** — on the web host this means two YouTube players with `setVolume` ramps.
   Technically possible; **compliance with YouTube's RMF is unverified**. Real mixing needs raw audio (the power host).
5. *(Not prioritised)* Desktop/Pi **power host** with go-librespot (real Spotify audio, raw PCM, ToS risk).
   **Native Android host** (needs a test build to see whether librespot runs on Android).
   **Check go-librespot's license** before bundling it with WTFPL code.

## 9. Risks & first spikes

| # | Risk | Spike |
|---|---|---|
| 1 | iOS Safari may not auto-advance to the next YouTube video without a tap | Build a minimal page: IFrame player, on `ENDED` call `loadVideoById(next)`, test on iPhone with the screen on. |
| 2 | Match accuracy below 95% | Build the test set first (see [nidol](https://github.com/Ofisalita/nidol)). |
| 3 | ytmusicapi (unofficial) breaks | The matching service keeps an official fallback: YouTube Data API search (10k units/day default; most sources say ~100 units per search, about 100 searches/day **(verify in the Cloud console)**). |
| 4 | Embedding-disabled videos (101/150) | Matching returns several candidates; the player falls through them automatically. |
| 5 | Ads interrupt the party | Accept for v1. Test whether a host signed in to YouTube Premium in the same browser gets ad-free embeds **(unverified)**. |
| 6 | Web Push setup on iOS confuses guests | Treat push as a bonus; in-page notifications are the baseline. |
