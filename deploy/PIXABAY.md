# Filling the board from Pixabay

Pixabay can't be reached from the Claude web sandbox (the network policy blocks it), so
the download is a human step. Fifteen minutes on a laptop. Everything after that is scripted.

## 1. Download

Go to https://pixabay.com/sound-effects/search/fantasy/ and save files into one folder,
e.g. `~/Downloads/fantasy-sounds`. Keep Pixabay's filenames: the importer reads them.
Free account needed for downloads; the mp3 button is enough, no need for wav.

A board that plays well has roughly this mix. Search the fantasy tag plus these words:

| Slot | Search inside the fantasy results | Want |
|---|---|---|
| Ambience (loops) | tavern, forest, cave, dungeon, castle, swamp, wind, rain, campfire, market | 8 to 10, each 20 s or longer |
| Combat (one-shots) | sword, shield, arrow, spell, fireball, magic, whoosh | 6 to 8, under 4 s |
| Stingers (one-shots) | door, chest, coins, bell, horn, fanfare, sting, footsteps, thunder | 8 to 10 |
| Creatures (one-shots) | dragon, monster, goblin, wolf, ghost, growl, roar | 6 to 8 |
| Music (loops) | drums, theme, harp, orchestral, battle music | 2 to 4 |

Ambience and music go in as loops; the board crossfades their tail into their head, so a
recording with a clean start and end loops fine even if it wasn't made as a loop.

## 2. Import

From the Dandanaka repo:

```bash
node scripts/import-sounds.mjs ~/Downloads/fantasy-sounds --dry-run   # look at the guesses
node scripts/import-sounds.mjs ~/Downloads/fantasy-sounds             # do it
```

The importer derives id, name, category and loop/one-shot from each filename, copies the
files into `public/sounds/`, and rewrites `manifest.json` with the synthesized pack removed
(`--keep-synth` to keep it). Fix any wrong guess with a map file:

```json
{ "epic-dragon-roar": { "name": "Dragon", "category": "creatures", "kind": "shot", "defaultVolume": 0.8 },
  "mystic-forest": { "kind": "loop", "gain": 1.3 } }
```

```bash
node scripts/import-sounds.mjs ~/Downloads/fantasy-sounds --map fixes.json
```

Then `npm start`, open the board, play through everything, and nudge `gain` in the
manifest for anything too loud or quiet. Commit and push; Dokploy redeploys from `main`.

## The licence question, in two sentences

Pixabay's Content Licence allows these sounds inside your own app or site with no credit,
and forbids passing them on as standalone files. Serving them from the soundboard is fine;
committing them to the public GitHub repo is the grey area, because anyone can clone it.

If you'd rather keep them out of git: import onto the VPS instead of into the repo.

```bash
ssh root@107.174.70.245 'mkdir -p /srv/dandanaka/sounds'
rsync -a ~/Downloads/fantasy-sounds/ root@107.174.70.245:/srv/dandanaka/incoming/
ssh root@107.174.70.245 'cd /srv/ptpf-build/dandanaka 2>/dev/null || git clone https://github.com/arvindhsundar/Dandanaka /srv/ptpf-build/dandanaka; cd /srv/ptpf-build/dandanaka && node scripts/import-sounds.mjs /srv/dandanaka/incoming --dest /srv/dandanaka/sounds'
```

`docker-compose.yml` already mounts `/srv/dandanaka/sounds` read-only at `/data/sounds` and
sets `EXTRA_SOUNDS_DIR`, so the server merges that manifest over the bundled one (same id
wins) and serves the files. No redeploy needed for new sounds; the manifest is read on each
request. Restart the container only if you add the volume for the first time.
