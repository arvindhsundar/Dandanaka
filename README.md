# Dandanaka

A soundboard for tabletop RPGs that plays from any device to every device.

The GM opens the board on a phone or laptop and taps a sound. Everyone who opened the room link (at the table or across the world) hears it at the same moment on their own device. Nothing is streamed: the server only sends "play *thunder* at 12:03:04.300" and each browser plays its own cached copy.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm test           # unit + integration tests
```

Open the page, tap **Start a session**, share the link (or the three-word code). Players open the link and tap **Tap to join audio** once. That single tap is required by every mobile browser before a page may make sound.

Try it on one machine: open the board in one tab and the room link in another.

## Deploy

Anything that runs Node 20+ and passes WebSocket upgrades through works. The app is a single process with no database; rooms live in memory and expire 3 hours after the last person leaves.

**Fly.io** (free allowance is enough):

```bash
fly launch --copy-config --no-deploy   # picks up fly.toml, choose an app name
fly deploy
```

**Railway / Render / any Docker host:** build the included `Dockerfile`, expose port 3000. Set `PORT` if the host wants a different one.

**puttheplayerfirst.com VPS (Dokploy + nginx):** see `deploy/VPS.md`. The app mounts at `/soundboard/` via `BASE_PATH`, and `deploy/nginx-soundboard.conf` is the proxy block for the site's nginx.

**Your own VPS:** `npm ci --omit=dev && PORT=3000 node server/index.js` behind Caddy or nginx with WebSocket proxying enabled. HTTPS is required for the "add to home screen" install and for the screen wake lock; both Fly and Railway give you that for free.

Environment variables: `PORT` (3000), `HOST` (0.0.0.0), `BASE_PATH` (empty; set `/soundboard` to mount under a path), `MAX_ROOMS` (500), `MAX_CLIENTS_PER_ROOM` (50).

## Sounds

**Pixabay or your own files:** `node scripts/harvest-pixabay.mjs` pulls a wishlist of sounds straight off Pixabay (it drives real Chrome, because pixabay.com blocks plain HTTP clients and has no audio API), or download into a folder yourself. Either way, `node scripts/import-sounds.mjs <folder>` finishes the job. It names, categorises and installs them, replacing the synthesized pack. Full walkthrough, including a pick list and the licence angle: `deploy/PIXABAY.md`. To keep such files out of git, set `EXTRA_SOUNDS_DIR` to a directory outside the repo; its `manifest.json` is merged over the bundled one.

The live board serves 87 pads: the bundled synthesized 36 plus 51 Pixabay sounds that live outside git on the VPS (see `deploy/pixabay-2026-09-09.json` for the credits).

The bundled pack (36 sounds, about 5 MB) is **synthesized** by `scripts/generate_sounds.py`, so it's CC0 by construction. Ambience like rain, wind, fire and ocean sounds fine. Creatures and fanfares are serviceable placeholders. Swap in real recordings when you want better:

```bash
FREESOUND_API_KEY=your_key npm run sounds:fetch          # all sounds
FREESOUND_API_KEY=your_key npm run sounds:fetch dragon-roar tavern   # just these
```

A key is free at https://freesound.org/apiv2/apply. The script searches Freesound with the CC0 filter, downloads the best-rated match, and writes attribution into `public/sounds/manifest.json`. The board shows credits at the bottom. Sounds you fetched survive a later `npm run sounds:generate`.

To add your own file: drop it in `public/sounds/` and add an entry to `manifest.json`:

```json
{ "id": "boss-theme", "name": "Boss theme", "category": "music", "kind": "loop",
  "file": "/sounds/boss-theme.mp3", "gain": 1.0, "defaultVolume": 0.7,
  "source": { "title": "...", "author": "...", "url": "...", "license": "CC0 1.0" } }
```

`kind` is `loop` (toggles, fades in and out, seamless via a baked crossfade) or `shot` (fires once, can overlap). Categories: `ambience`, `combat`, `stingers`, `creatures`, `music`. Use mp3 or m4a; Safari won't decode ogg. Only bundle sounds whose license allows redistribution (CC0 or CC-BY with credit). Pixabay's license forbids redistributing files standalone, and Tabletop Audio is NC-ND, so keep those out of the repo.

## How it stays in sync

- Every client pings the server 8 times on connect and every 20s after, and keeps a median offset from the lowest-latency samples (`public/sync.js`).
- Every GM command is stamped with a server time 300ms in the future. Each device converts that to its own AudioContext clock and schedules the sound sample-accurately.
- Loops carry their original start time, so a late joiner starts the rain at the same position everyone else is hearing.
- The GM's own device plays through the server echo too, so the table hears one hit instead of two.
- If the server is unreachable the GM's board plays locally and reconnects in the background. When it reconnects with loops running, the GM's board state wins.

## Known limits

- Phones stop web audio when the screen locks or the browser goes to the background. Listeners need the tab in front. A wake lock keeps the screen on where the browser allows it.
- iOS with the ring/silent switch on: the app plays a silent audio element to move into "playback" mode, which makes Web Audio honour the volume buttons instead of the switch. This works on current iOS but Apple changes it now and then.
- Rooms are in memory. A server restart drops them; the GM makes a new one and shares the new link.
- Sync is typically 20-80ms across the internet. Within a room around a table that's a slight thickening, not an echo. If it bothers you, have only one device at the table unmuted.

## Layout

```
server/index.js   HTTP static + WebSocket transport
server/room.js    room state, GM auth, command validation (pure, tested)
public/app.js     routing, socket client, GM board, listener view
public/audio.js   Web Audio engine: preload, one-shots, gapless loops, mobile unlock
public/sync.js    clock offset estimation
public/sw.js      service worker: app shell + sounds cached for offline
scripts/          sound generator and Freesound fetcher
test/             node:test unit and integration tests
```
