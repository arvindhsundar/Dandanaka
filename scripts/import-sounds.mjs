#!/usr/bin/env node
// Import downloaded sound files (Pixabay, your own recordings, anything) into the board.
//
//   node scripts/import-sounds.mjs <folder> [--dest <dir>] [--keep-synth] [--map <file.json>] [--dry-run]
//
// Reads every .mp3/.m4a/.wav/.ogg in <folder>, derives an id + display name from the
// filename (Pixabay names look like "dragon-roar-fantasy-120345.mp3"; the trailing number
// is dropped), guesses category and loop/one-shot from keywords, copies the file into
// --dest (default public/sounds) and writes the manifest.
//
// Default is "instead of" the synthesized pack: synthesized entries are removed from the
// manifest (their files are left on disk). Pass --keep-synth to add alongside them.
//
// --map lets you override anything per file: { "dragon-roar": { "name": "Big dragon",
// "category": "creatures", "kind": "shot", "defaultVolume": 0.8, "gain": 1.2 } }
// Keys match either the derived id or the original filename.
//
// Licence note for Pixabay files: the Pixabay Content Licence allows use inside an app or
// website with no attribution, but not redistribution as standalone files. Serving them
// from your own soundboard is the intended use. Committing them to a PUBLIC GitHub repo is
// the grey area; if that bothers you, import with --dest /srv/dandanaka/sounds on the VPS
// and set EXTRA_SOUNDS_DIR (see README), which keeps them out of git entirely.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AUDIO = new Set(['.mp3', '.m4a', '.wav', '.ogg']);

const CATEGORY_RULES = [
  ['ambience', /\b(ambien|atmos|loop|wind|rain|storm|thunder ?storm|forest|jungle|swamp|cave|dungeon|tavern|inn|market|village|town|crowd|ocean|sea|waves|river|stream|fire|campfire|night|crickets|birds|drone|hum|desert|snow|blizzard|castle|temple|crypt|graveyard|ship|underwater)\b/],
  ['creatures', /\b(dragon|monster|beast|creature|growl|roar|snarl|wolf|howl|goblin|orc|troll|ogre|zombie|undead|ghost|spirit|demon|hiss|screech|bat|bird|owl|crow|raven|horse|neigh|whinny|dog|bark|lion|bear|spider|insect|dinosaur|giant)\b/],
  ['combat', /\b(sword|blade|dagger|knife|axe|mace|hammer|shield|armor|armour|clash|clang|hit|punch|slash|stab|slice|impact|arrow|bow|crossbow|spear|battle|war|fight|combat|attack|block|parry|whoosh|swing|gun|cannon|explosion|blast|fireball|lightning|zap|spell|magic|cast|heal|buff|curse|summon|teleport|portal)\b/],
  ['music', /\b(music|theme|song|melody|orchestra|orchestral|drums?|harp|flute|lute|choir|piano|strings|soundtrack|score|jingle|fanfare|intro|outro)\b/],
];
const LOOP_HINT = /\b(loop|ambien|atmos|drone|background|bg|soundscape)\b/;

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function derive(filename) {
  let base = path.basename(filename, path.extname(filename));
  base = base.replace(/[-_ ]\d{3,}$/, '');          // pixabay numeric id
  base = base.replace(/[-_ ]?\(\d+\)$/, '');          // "(1)" duplicates
  const id = slug(base).slice(0, 64) || 'sound';
  const name = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const hay = ` ${base.toLowerCase().replace(/[-_]+/g, ' ')} `;
  let category = 'stingers';
  for (const [cat, re] of CATEGORY_RULES) if (re.test(hay)) { category = cat; break; }
  const kind = (category === 'ambience' || category === 'music' || LOOP_HINT.test(hay)) ? 'loop' : 'shot';
  return { id, name, category, kind };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const flag = (k) => args.includes(k);
  const folder = args.find((a) => !a.startsWith('--') && !['--dest', '--map'].includes(args[args.indexOf(a) - 1]));
  if (!folder) { console.error('usage: node scripts/import-sounds.mjs <folder> [--dest <dir>] [--keep-synth] [--map <file.json>] [--dry-run]'); process.exit(1); }
  const dest = path.resolve(opt('--dest') || path.join(ROOT, 'public', 'sounds'));
  const keepSynth = flag('--keep-synth');
  const dry = flag('--dry-run');
  const map = opt('--map') ? JSON.parse(fs.readFileSync(opt('--map'), 'utf8')) : {};

  const files = fs.readdirSync(folder).filter((f) => AUDIO.has(path.extname(f).toLowerCase())).sort();
  if (!files.length) { console.error(`no audio files in ${folder}`); process.exit(1); }

  const manifestPath = path.join(dest, 'manifest.json');
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  if (!keepSynth) manifest = manifest.filter((e) => !/synthesized/i.test(e.source?.title || ''));

  const seen = new Set(manifest.map((e) => e.id));
  const added = [];
  for (const f of files) {
    const d = derive(f);
    const over = map[d.id] || map[f] || {};
    let id = over.id || d.id;
    let n = 2; while (seen.has(id) && !manifest.find((e) => e.id === id && e.source?.imported)) id = `${d.id}-${n++}`;
    seen.add(id);
    const ext = path.extname(f).toLowerCase();
    const outName = `${id}${ext}`;
    const entry = {
      id, name: over.name || d.name, category: over.category || d.category, kind: over.kind || d.kind,
      file: `sounds/${outName}`, gain: over.gain ?? 1.0, defaultVolume: over.defaultVolume ?? (d.kind === 'loop' ? 0.7 : 1),
      source: { title: over.title || path.basename(f), author: over.author || 'Pixabay contributor', url: over.url || 'https://pixabay.com/sound-effects/', license: over.license || 'Pixabay Content License', imported: true },
    };
    const idx = manifest.findIndex((e) => e.id === id);
    if (idx >= 0) manifest[idx] = entry; else manifest.push(entry);
    added.push(entry);
    if (!dry) { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(path.join(folder, f), path.join(dest, outName)); }
    console.log(`${dry ? 'would add' : 'added   '} ${id.padEnd(28)} ${entry.category.padEnd(9)} ${entry.kind.padEnd(4)} <- ${f}`);
  }
  const order = { ambience: 0, combat: 1, stingers: 2, creatures: 3, music: 4 };
  manifest.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || a.name.localeCompare(b.name));
  if (!dry) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const total = files.reduce((s, f) => s + fs.statSync(path.join(folder, f)).size, 0);
  console.log(`\n${added.length} sounds, ${(total / 1e6).toFixed(1)} MB -> ${dest}${dry ? ' (dry run, nothing written)' : ''}`);
  console.log(keepSynth ? 'synthesized pack kept.' : 'synthesized pack removed from the manifest (files left on disk; delete public/sounds/*.mp3 you no longer want).');
  console.log('Check the guessed category/kind above; fix any with --map. Open the board and adjust "gain" for sounds that are too loud or quiet.');
}
export { derive };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
