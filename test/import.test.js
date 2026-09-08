import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { derive } from '../scripts/import-sounds.mjs';

test('derives id, name, category and kind from pixabay-style filenames', () => {
  assert.deepEqual(derive('dragon-roar-fantasy-120345.mp3'), { id: 'dragon-roar-fantasy', name: 'Dragon Roar Fantasy', category: 'creatures', kind: 'shot' });
  assert.deepEqual(derive('medieval-tavern-ambience-loop-6005.mp3'), { id: 'medieval-tavern-ambience-loop', name: 'Medieval Tavern Ambience Loop', category: 'ambience', kind: 'loop' });
  assert.equal(derive('sword_clash_hit (1).wav').category, 'combat');
  assert.equal(derive('epic-fantasy-theme-music-22222.mp3').kind, 'loop');
  assert.equal(derive('magic-sparkle.mp3').category, 'combat');
  assert.equal(derive('door creak.mp3').category, 'stingers');
});

test('imports a folder, replaces the synthesized pack, honours --map', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
  const src = path.join(tmp, 'downloads'); const dest = path.join(tmp, 'sounds');
  fs.mkdirSync(src); fs.mkdirSync(dest);
  for (const f of ['dragon-roar-fantasy-120345.mp3', 'medieval-tavern-ambience-loop-6005.mp3', 'notes.txt']) fs.writeFileSync(path.join(src, f), 'x');
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify([
    { id: 'rain', name: 'Rain', category: 'ambience', kind: 'loop', file: 'sounds/rain.mp3', source: { title: 'Rain (synthesized)' } },
    { id: 'mine', name: 'Mine', category: 'music', kind: 'loop', file: 'sounds/mine.mp3', source: { title: 'my own' } },
  ]));
  fs.writeFileSync(path.join(tmp, 'map.json'), JSON.stringify({ 'dragon-roar-fantasy': { name: 'Big dragon', defaultVolume: 0.5 } }));
  execFileSync(process.execPath, ['scripts/import-sounds.mjs', src, '--dest', dest, '--map', path.join(tmp, 'map.json')], { stdio: 'pipe' });
  const m = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  assert.deepEqual(m.map((e) => e.id), ['medieval-tavern-ambience-loop', 'dragon-roar-fantasy', 'mine']);
  const dragon = m.find((e) => e.id === 'dragon-roar-fantasy');
  assert.equal(dragon.name, 'Big dragon'); assert.equal(dragon.defaultVolume, 0.5); assert.equal(dragon.source.imported, true);
  assert.ok(fs.existsSync(path.join(dest, 'dragon-roar-fantasy.mp3')));
  assert.ok(!m.find((e) => e.id === 'rain'), 'synthesized entry removed');
  // --keep-synth keeps it
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify([{ id: 'rain', name: 'Rain', category: 'ambience', kind: 'loop', file: 'sounds/rain.mp3', source: { title: 'Rain (synthesized)' } }]));
  execFileSync(process.execPath, ['scripts/import-sounds.mjs', src, '--dest', dest, '--keep-synth'], { stdio: 'pipe' });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).find((e) => e.id === 'rain'));
});
