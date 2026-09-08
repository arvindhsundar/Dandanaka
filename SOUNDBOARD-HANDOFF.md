# Soundboard handoff

Written 2026-09-08 by the Claude Code web session that built this. For the Mac session
(and any human) picking it up.

**Where the work is:** repo `https://github.com/arvindhsundar/Dandanaka` (remote `origin`).
Identical content on three branches: `main`, `claude/tabletop-rpg-soundboard-pv20mf`
(the session's working branch) and `claude/soundboard-handoff` (this handoff).
Related: `arvindhsundar/puttheplayerfirst-site` PR #1 (branch `soundboard-nginx`) carries
the nginx proxy block and the robots.txt line. Nothing is deployed anywhere yet.

Everything is committed. There is no work in progress outside git.

## What Arvindh asked for, in his words

| Ask | Status |
|---|---|
| "I want a soundboard that I can play from anywhere." | Done. Web app, any browser, installable PWA. GM board runs on phone or laptop. |
| "I would like to use this when I am playing at my table." | Done. Solo mode needs no server; a room works with one device unmuted at the table. |
| "play that sound from any device" | Done. GM identity is a token in localStorage, so the board opens on whichever device created the room; the join link works on anything with a browser. |
| "use free sounds that are there on the internet, so I'll probably need your help to find some of them" | Partly done. The build box could not reach freesound.org, kenney.nl or opengameart.org (network policy 403), so the bundled 36-sound pack is synthesised (CC0 by construction). `scripts/fetch-sounds.mjs` swaps in real CC0 Freesound recordings given a free API key. **Outstanding: run that script from a machine with internet, then listen and adjust per-sound `gain` in the manifest.** |
| "multiple people all over the world or all around the table can connect and listen to the same sound" | Done. Room code + link, WebSocket broadcast, clock sync, scheduled playback, late-joiner catch-up. |
| "not just from my speaker, but also, like, through the internet" | Done. Each listener's device plays its own cached copy; nothing is streamed. |
| "Help me bulletproof this before you begin execution." | Done. Design review happened before code; the trap list (autoplay gate, iOS silent switch, late joiners, reconnect, offline GM, preload, loop vs one-shot, licensing, abuse) is all implemented. |
| "I have another repo with my website. You can use that too" | Done. App mounts under `/soundboard/` via `BASE_PATH`, restyled to the site's lime-on-black + Barlow, nginx block + robots change in site PR #1, Dokploy compose file, VPS runbook in `deploy/VPS.md`. |
| "can you do this now?" (go live) | Partly done. `main` created; site PR #1 opened. **Outstanding: Dokploy Compose app creation and the nginx apply on the box, both need SSH/Dokploy access the web session did not have.** |

Decisions Arvindh made when asked (2026-09-07): plain Node server (not Cloudflare), browser
tab per remote player (no Discord bot), curated pack only (no uploads in v1), vanilla JS.

Explicitly deferred, not asked for yet: Discord voice output, user uploads, playlists/scenes.

## Run it

```bash
npm install          # only dependency: ws
npm start            # http://localhost:3000
npm test             # 15 tests: room logic, clock sync, real server over HTTP + WebSocket
```

No build step. Vanilla JS modules served straight from `public/`. Node 20+.

Mount under a prefix: `BASE_PATH=/soundboard npm start` then open `http://localhost:3000/soundboard/`.

Env: `PORT` (3000), `HOST` (0.0.0.0), `BASE_PATH` (empty), `MAX_ROOMS` (500), `MAX_CLIENTS_PER_ROOM` (50).

Docker: `Dockerfile` (node:22-alpine, port 3000). `docker-compose.yml` is written for Dokploy on the
PTPF VPS (container `dandanaka` on external network `dokploy-network`, `BASE_PATH=/soundboard`, no
published port; nginx reaches it by name).

## Audio

- 36 mp3 files in `public/sounds/`, 4.7 MB total, mono 44.1 kHz 112 kbps. Catalogue in
  `public/sounds/manifest.json` (id, name, category, loop/shot, file, gain, defaultVolume, source/licence).
- All are **synthesised** by `scripts/generate_sounds.py` (numpy + scipy + lameenc). Ambience
  (rain, wind, storm, forest night, campfire, dungeon, cave, ocean, tavern, heartbeat) is decent.
  Combat, stingers and creatures are usable placeholders. Music loops (war drums, tension drone,
  mystery pad) are fine as beds.
- Regenerate: `pip install numpy scipy lameenc && npm run sounds:generate` (about 60 s).
- Real recordings: `FREESOUND_API_KEY=xxx npm run sounds:fetch [id ...]` searches Freesound with
  the CC0 filter, downloads the best-rated HQ preview per slot, rewrites the manifest with attribution.
  Fetched sounds survive a later regenerate.
- Yes, they can be served as static files: paths are relative (`sounds/rain.mp3`), served with
  `cache-control: immutable` and Range support. The service worker caches them cache-first.
  But the app itself needs the Node process for rooms (`/api/rooms`, `/ws`); only solo mode works
  from a static host, and index.html expects the server to rewrite `<base href="/">` when mounted
  under a prefix.

## Architecture in one paragraph

`server/room.js` is pure room state (GM token, loops with start time, master volume, command
validation), unit tested. `server/index.js` is static files + WebSocket transport + a 20-per-10-min
room-creation limiter. Every GM command is stamped `at = serverNow + 300 ms` and broadcast to
everyone including the GM, so the table hears one hit. `public/sync.js` estimates clock offset from
the lowest-RTT pings. `public/audio.js` preloads and decodes all sounds, plays one-shots and gapless
loops (crossfade baked into the buffer) at the scheduled AudioContext time, and handles the mobile
unlock: a silent `<audio>` element pins iOS into playback mode so the ring/silent switch does not
mute Web Audio. `public/app.js` is routing, socket client with backoff, GM board, listener view.
If the server is unreachable the GM's device keeps playing locally; on reconnect with loops running,
the GM's board state wins.

## Verified

- `npm test`: 15/15.
- Headless Chromium end-to-end, at `/` and at `/soundboard/`: create room, GM loads 36 sounds
  (peak/RMS checked per file, none silent or clipped), listener joins and syncs, loop reaches
  listener, per-loop and master volume propagate, late joiner picks up a running loop, stop-all
  clears everyone, GM reload adopts server state, solo board works, service worker activates,
  zero same-origin console or request errors.

## Not verified / known limits

- **Never run on a real iPhone or Android.** The iOS silent-switch workaround and lock-screen
  behaviour are the first things to test at a table.
- Google Fonts (Barlow) was blocked in the build sandbox; the font link is non-blocking with a
  system fallback, so it renders either way, but the Barlow rendering itself was not seen.
- Rooms are in memory. Restart or redeploy drops active sessions.
- Sync is typically 20-80 ms across the internet. Around one table with several unmuted phones
  that reads as a slight thickening, not an echo.
- Repo default branch on GitHub is still `claude/tabletop-rpg-soundboard-pv20mf`; `main` exists
  but was not set as default (no tool for that in the web session).

## Deploying to puttheplayerfirst.com/soundboard/

Full runbook: `deploy/VPS.md`. Short version:

1. Dokploy → Create → Compose → GitHub `arvindhsundar/Dandanaka`, branch `main`,
   compose path `docker-compose.yml`. Deploy. Public repo, no deploy key.
2. Merge site PR #1, copy `server/nginx.conf` over the live file on the box (backup first),
   `nginx -t`, `nginx -s reload`.
3. `curl -sS https://puttheplayerfirst.com/soundboard/ | grep -o '<base href="[^"]*">'` prints `/soundboard/`.

**Collision warning for the Mac session:** the nginx block proxies the whole `/soundboard/`
prefix to the container. Any static files published into the web root at `/soundboard/`
(the minimal rebuild) will be shadowed once the block is live, and the site's `deploy.sh`
`--delete` will remove them on the next publish anyway. Do not merge the two; this app owns
the path.
