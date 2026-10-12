# bye0

one shared music queue for the whole party, no matter which streaming service each friend uses 😉

(it's pronounced "vinyl")

## The Why

a group of friends with different streaming platforms and a single "aux cord" can't share a queue, because
these services don't play nice with each other.

## How it works

bye0 is a web page. nobody installs anything and nobody needs an account.

**if you're hosting**

1. open bye0, type a nickname and pick a party style:
   - **Chill dinner**: songs play in the order they were added, and only you can skip.
   - **House party**: everyone takes turns, and skips are decided by vote. your vote counts the same as
     everyone else's.
2. tap **Play on this device** and then **Start playing here** on whatever is plugged into the speakers
   (your phone, a laptop, a TV browser).
3. guests scan the QR code on that screen, or type the 4-letter code.

you can change the rules mid-party. "who decides" has three settings:

- **Host only**: you skip, remove and reorder songs. guests can only take back their own.
- **Full democracy**: skips need enough votes, and you're just one more voter.
- **Presidential democracy**: guests vote to skip, but you can skip, remove or move any song to the front
  without asking.

whatever the rules, you can kick people, and make a friend co-host so their device can take over the music
if yours dies.

**if you're a guest**

1. scan the QR code (or open bye0 and type the code), then pick a nickname.
2. paste a song link and hit **Add**.
3. watch the queue, vote to skip, take back your own songs if you change your mind.

## Good to know

- music plays through YouTube, so **the playing device has to keep its screen on with bye0 in front**.
  bye0 keeps the screen awake for you where the browser allows it.
- YouTube ads will show up and bye0 can't skip them.
- the join code changes every few minutes, so use the one currently on screen.
- nothing is saved. when the party ends, everything about it is gone.
- available in English and Spanish (it follows your browser language; you can switch on the start page).

## What works today

bye0 is in early development.

| | |
|---|---|
| YouTube and YouTube Music links | ✅ |
| Spotify, Apple Music, Deezer, Tidal links | 🚧 coming next |
| searching for a song by name | 🚧 |
| more party styles (song battles, minigames to settle skips, a rotating DJ crown…) | 🚧 |
| "your song is next" notifications | 🚧 |
| skins and a visualizer | later |

## Run your own

there's no public bye0 yet, so for now you host it yourself. you need [Bun](https://bun.sh).

```sh
bun install
bun run dev:server            # the party server, on port 3001
bun run dev:web -- --host     # the web app, on port 5173
```

open `http://<your-computer's-ip>:5173` on any device on the same Wi-Fi.

## License

[WTFPL](http://www.wtfpl.net/)
