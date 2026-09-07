#!/usr/bin/env node
// Swap the synthesized starter sounds for real CC0 recordings from Freesound.
//
//   FREESOUND_API_KEY=xxxx npm run sounds:fetch
//
// Get a free key at https://freesound.org/apiv2/apply (takes a minute).
// Searches each sound by query with the CC0 filter, takes the best rated hit,
// downloads the HQ mp3 preview (no OAuth needed), and updates manifest.json
// with the file plus proper attribution. Re-running skips sounds already fetched.
// To go back to a synthesized sound, delete its entry's "source.fetched" flag and
// run `npm run sounds:generate`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.FREESOUND_API_KEY;
if (!KEY) { console.error('Set FREESOUND_API_KEY (free at https://freesound.org/apiv2/apply)'); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = path.join(__dirname, '..', 'public', 'sounds');
const MANIFEST = path.join(SOUNDS_DIR, 'manifest.json');

// id -> { q: search query, min/max duration in seconds }
const QUERIES = {
  'rain': { q: 'rain loop ambience', min: 15, max: 120 },
  'storm': { q: 'thunderstorm rain ambience', min: 20, max: 180 },
  'wind': { q: 'wind loop', min: 15, max: 120 },
  'forest-night': { q: 'forest night crickets ambience', min: 20, max: 180 },
  'campfire': { q: 'campfire crackling loop', min: 15, max: 120 },
  'dungeon': { q: 'dungeon ambience drips', min: 20, max: 180 },
  'cave-drone': { q: 'cave drone ambience', min: 20, max: 180 },
  'ocean': { q: 'ocean waves loop', min: 20, max: 180 },
  'tavern': { q: 'tavern crowd ambience', min: 20, max: 180 },
  'heartbeat': { q: 'heartbeat loop', min: 4, max: 60 },
  'sword-clash': { q: 'sword clash metal', min: 0.3, max: 4 },
  'heavy-hit': { q: 'heavy impact hit', min: 0.3, max: 4 },
  'shield-block': { q: 'shield block metal impact', min: 0.3, max: 4 },
  'arrow': { q: 'arrow whoosh impact', min: 0.3, max: 4 },
  'spell-cast': { q: 'magic spell cast', min: 0.5, max: 6 },
  'explosion': { q: 'explosion', min: 0.5, max: 6 },
  'thunder': { q: 'thunder clap', min: 2, max: 15 },
  'door-creak': { q: 'door creak wooden', min: 0.5, max: 6 },
  'door-slam': { q: 'door slam', min: 0.3, max: 4 },
  'chest-open': { q: 'chest open wooden', min: 0.5, max: 5 },
  'coins': { q: 'coins jingle', min: 0.3, max: 5 },
  'dice-roll': { q: 'dice roll table', min: 0.5, max: 5 },
  'footsteps': { q: 'footsteps stone', min: 1, max: 8 },
  'bell-toll': { q: 'church bell toll single', min: 1, max: 10 },
  'dramatic-sting': { q: 'dramatic sting orchestral', min: 1, max: 10 },
  'victory-fanfare': { q: 'victory fanfare', min: 1, max: 12 },
  'horn-call': { q: 'horn call medieval', min: 1, max: 10 },
  'dragon-roar': { q: 'dragon roar', min: 1, max: 8 },
  'monster-growl': { q: 'monster growl', min: 0.5, max: 6 },
  'wolf-howl': { q: 'wolf howl', min: 1, max: 10 },
  'owl': { q: 'owl hoot', min: 0.5, max: 8 },
  'crow': { q: 'crow caw', min: 0.5, max: 6 },
  'bones-rattle': { q: 'bones rattle', min: 0.5, max: 6 },
  'war-drums': { q: 'war drums loop', min: 4, max: 60 },
  'tension-drone': { q: 'tension drone loop', min: 10, max: 180 },
  'mystery-pad': { q: 'mysterious ambient pad loop', min: 10, max: 180 },
};

const only = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const api = async (url) => {
  const r = await fetch(url, { headers: { Authorization: `Token ${KEY}` } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
};

for (const entry of manifest) {
  const spec = QUERIES[entry.id];
  if (!spec || (only.length && !only.includes(entry.id))) continue;
  if (entry.source?.fetched && !only.length) { console.log(`skip   ${entry.id} (already fetched)`); continue; }
  const filter = `license:"Creative Commons 0" duration:[${spec.min} TO ${spec.max}]`;
  const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(spec.q)}&filter=${encodeURIComponent(filter)}&sort=rating_desc&fields=id,name,username,license,url,previews,duration&page_size=5`;
  try {
    const res = await api(url);
    const hit = res.results?.[0];
    if (!hit) { console.log(`none   ${entry.id}: no CC0 result for "${spec.q}"`); continue; }
    const mp3 = hit.previews['preview-hq-mp3'];
    const buf = Buffer.from(await (await fetch(mp3)).arrayBuffer());
    const file = `${entry.id}.mp3`;
    fs.writeFileSync(path.join(SOUNDS_DIR, file), buf);
    entry.file = `sounds/${file}`;
    entry.source = { title: hit.name, author: hit.username, url: hit.url, license: 'CC0 1.0', fetched: true, freesoundId: hit.id };
    console.log(`fetched ${entry.id}: "${hit.name}" by ${hit.username} (${hit.duration.toFixed(1)}s)`);
    await new Promise((r) => setTimeout(r, 400)); // be polite to the API
  } catch (e) {
    console.log(`error  ${entry.id}: ${e.message}`);
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log('manifest updated. Listen through the board and adjust "gain" per sound if levels are uneven.');
