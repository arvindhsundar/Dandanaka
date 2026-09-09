#!/usr/bin/env node
// Harvest sound effects from Pixabay into a folder that scripts/import-sounds.mjs can read.
//
//   node scripts/harvest-pixabay.mjs [--list scripts/pixabay-wishlist.json] [--out .harvest]
//
// Why a browser and not curl: pixabay.com sits behind a Cloudflare challenge, so a plain
// HTTP client gets a 403. Real Chrome passes it. The detail page HTML carries the public
// cdn.pixabay.com download URL, and THAT URL is fetchable with curl, no login and no key.
// There is no Pixabay API for audio, so this is the route.
//
// Needs Playwright and a local Chrome:  npm i -D playwright   (channel: 'chrome')
//
// The wishlist is [id, name, category, kind, query, minSeconds, maxSeconds] per line.
// For each entry it searches, walks the first few results, downloads the first hit whose
// duration is in range, and records title / author / page URL in <out>/meta.json.
//
// Afterwards: transcode to small mono mp3s, build a --map from meta.json, and run
//   node scripts/import-sounds.mjs <transcoded dir> --dest <dir> --map map.json
// See deploy/PIXABAY.md.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LIST = path.resolve(opt('--list', path.join(ROOT, 'scripts', 'pixabay-wishlist.json')));
const OUT = path.resolve(opt('--out', path.join(ROOT, '.harvest')));
const RAW = path.join(OUT, 'raw');
const META = path.join(OUT, 'meta.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

fs.mkdirSync(RAW, { recursive: true });
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
const wanted = JSON.parse(fs.readFileSync(LIST, 'utf8'));

const duration = (f) => {
  try { return parseFloat(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()); }
  catch { return 0; }
};

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await (await browser.newContext()).newPage();
// Skip the heavy stuff; we only need HTML.
await page.route('**/*', (r) => (['image', 'font', 'media', 'stylesheet'].includes(r.request().resourceType()) ? r.abort() : r.continue()));

for (const [id, name, category, kind, query, minD, maxD] of wanted) {
  if (meta[id]) { console.log(`skip   ${id}`); continue; }
  let links = [];
  try {
    await page.goto(`https://pixabay.com/sound-effects/search/${encodeURIComponent(query)}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    links = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter((h) => /^\/sound-effects\/[a-z0-9-]+-\d+\/$/.test(h || '')))]);
  } catch (e) { console.log(`search fail ${id}: ${e.message.slice(0, 60)}`); }
  if (!links.length) { console.log(`NONE   ${id} (${query})`); continue; }

  let ok = false;
  for (const href of links.slice(0, 5)) {
    const pageUrl = `https://pixabay.com${href}`;
    let html;
    try { await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(1200); html = await page.content(); }
    catch { continue; }
    const hit = html.match(/https:\/\/cdn\.pixabay\.com\/download\/audio\/[^"'<>\\ ]+\.mp3\?filename=[^"'<>\\ ]+/);
    if (!hit) continue;
    const url = hit[0].replace(/&amp;/g, '&');
    const raw = (html.match(/<meta property="og:title" content="([^"]+)"/) || [, ''])[1].replace(/\s*\|\s*Pixabay.*$/, '').replace(/\s*\|\s*Royalty-free Music\s*$/, '').trim();
    const m = raw.match(/^(.*)\sby\s([^|]+)$/);
    const title = m ? m[1].trim() : raw;
    const author = m ? m[2].trim() : decodeURIComponent(url.split('filename=')[1]).split('-')[0];
    const file = path.join(RAW, `${id}.mp3`);
    try { execFileSync('curl', ['-sSL', '--max-time', '120', '-o', file, '-A', UA, '-H', 'Referer: https://pixabay.com/', url]); }
    catch { continue; }
    const d = duration(file);
    if (!d || d < minD || d > maxD) { console.log(`  reject ${id} ${d.toFixed(1)}s (want ${minD}-${maxD}) ${pageUrl}`); fs.rmSync(file, { force: true }); continue; }
    meta[id] = { id, name, category, kind, query, page: pageUrl, url, title, author, duration: d, size: fs.statSync(file).size };
    fs.writeFileSync(META, JSON.stringify(meta, null, 2));
    console.log(`OK     ${id.padEnd(16)} ${d.toFixed(1)}s  "${title}" by ${author}`);
    ok = true;
    break;
  }
  if (!ok) console.log(`FAILED ${id} (${query})`);
}

await browser.close();
console.log(`\n${Object.keys(meta).length} of ${wanted.length} collected into ${OUT}`);
