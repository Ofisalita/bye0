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
   - **Chaos**: songs play in a random order, and anyone can skip, remove or move any song to the front.
2. tap **Play on this device** and then **Start playing here** on whatever is plugged into the speakers
   (your phone, a laptop, a TV browser).
3. guests scan the QR code on that screen, or type the 4-letter code.

you can change the rules mid-party. "who decides" has four settings:

- **Host only**: you skip, remove and reorder songs. guests can only take back their own.
- **Full democracy**: skips need enough votes, and you're just one more voter.
- **Presidential democracy**: guests vote to skip, but you can skip, remove or move any song to the front
  without asking.
- **Anarchy**: anyone skips, removes or moves any song to the front, no vote needed.

"queue order" can also go by votes: **Most voted first** plays the songs with the most ▲, and **Hot** does
the same but lets old votes fade (a vote is worth half after ten minutes), so recent favourites win.

whatever the rules, you can kick people, and make a friend co-host so their device can take over the music
if yours dies.

on a wide screen, **Bigger queue** shrinks the video and gives the room to the list of upcoming songs.
**Bigger video** switches back.

**if you're a guest**

1. scan the QR code (or open bye0 and type the code), then pick a nickname.
2. paste a song link and hit **Add**.
3. watch the queue, vote to skip, take back your own songs if you change your mind.
4. if the host set the queue to go by votes, tap **▲** on the songs you want to hear sooner. tap it again
   to take your vote back.

you can also send songs straight from your music app, once you've joined:

- **Android**: install bye0 from the browser menu (**Add to Home screen** / **Install app**). after that,
  **Share → bye0** in Spotify, YouTube Music and the like adds the song.
- **iPhone**: Safari can't do that, so make a shortcut once in the Shortcuts app: turn on **Show in Share
  Sheet**, add **URL Encode** on the shortcut input, then **Open URLs** with
  `https://<where bye0 lives>/share?url=` followed by the encoded text. it opens bye0 in Safari, so join the
  party in Safari too.

## Good to know

- music plays through YouTube, so **the playing device has to keep its screen on with bye0 in front**.
  bye0 keeps the screen awake for you where the browser allows it.
- if the playing device loses its connection for a moment, the music keeps going and it picks the party
  back up by itself when the connection returns.
- YouTube ads will show up and bye0 can't skip them.
- the join code changes every few minutes, so use the one currently on screen.
- nothing is kept after the party. when it ends (or nobody has touched it for 6 hours), everything about it is gone.
  while it's on, a restart of the bye0 server doesn't end it: everyone reconnects by themselves.
- available in English and Spanish (it follows your browser language; you can switch on the start page).

## What works today

bye0 is in early development.

| | |
|---|---|
| YouTube and YouTube Music links | ✅ |
| Spotify song links | ✅ if you also run the matching service (see below) |
| choosing the right version when the match is unsure | ✅ (with the matching service) |
| Spotify albums and playlists | 🚧 bye0 is ready (the host turns it on); waiting on the matching service |
| Apple Music, Deezer, Tidal links | 🚧 coming next |
| searching for a song by name | 🚧 bye0 is ready; waiting on the matching service |
| more party styles (song battles, minigames to settle skips, a rotating DJ crown…) | 🚧 |
| "your song is next" notifications | 🚧 |
| skins and a visualizer | later |

## Run your own

there's no public bye0 yet, so for now you host it yourself. it runs on [Bun](https://bun.sh); if you
don't have it, this installs it for your user (no sudo):

```sh
./scripts/install-bun.sh
```

then, in a new terminal:

```sh
bun install
bun run dev:server            # the party server, on port 3001
bun run dev:web -- --host     # the web app, on port 5173
```

open `http://<your-computer's-ip>:5173` on any device on the same Wi-Fi.

### Spotify links

on its own, bye0 only understands YouTube links. Spotify links are handled by
[nidol](https://github.com/Ofisalita/nidol), a separate matching service that finds the same song on YouTube.
it needs [uv](https://docs.astral.sh/uv/) (or Docker; see its README). run it next to bye0:

```sh
git clone https://github.com/Ofisalita/nidol
cd nidol
uv sync
uv run nidol                  # the matching service, on port 8000
```

then start the party server pointing at it, instead of the plain `dev:server` above:

```sh
MATCHING_URL=http://localhost:8000 bun run dev:server
```

add `MATCHING_COUNTRY=CL` (any two-letter country code) to get search results for your country.

if nidol is down or can't handle a link, YouTube links keep working and guests are asked to paste one.

### Surviving restarts

by default parties live in the party server's memory, so restarting it ends them. give it a
[Redis](https://redis.io) (or [Valkey](https://valkey.io)) and they survive:

```sh
REDIS_URL=redis://localhost:6379 bun run dev:server
```

the Docker Compose setup already includes one.

## License

[WTFPL](http://www.wtfpl.net/)
