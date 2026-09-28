import { createRequire } from 'module';
import { execSync, spawn } from 'child_process';
const require = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium } = require('playwright');
// Headless check of the first-time tour. Needs playwright (global install is fine).
//   node test/tour.e2e.mjs [screenshot-dir]
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..'), OUT = process.argv[2] || tmpdir();
const srv = spawn('node', ['server/index.js'], { cwd: DIR, env: { ...process.env, PORT: '3917', HOST: '127.0.0.1', BASE_PATH: '/soundboard' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const U = 'http://127.0.0.1:3917/soundboard/';
let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const b = await chromium.launch();
const errs = [];
for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.waitForSelector('.tour');
  ok(`${label}: home tour opens on first visit`, await p.isVisible('.tour-card'));
  await p.screenshot({ path: `${OUT}/${label}-home-1.png` });
  const n = Number((await p.textContent('#tour-count')).split(' of ')[1]);
  ok(`${label}: home tour has 4 steps (${n})`, n === 4);
  await p.click('#tour-next'); await p.waitForTimeout(250);
  ok(`${label}: step 2 rings the Start button`, (await p.textContent('#tour-title')) === 'Are you the GM?' && await p.isVisible('.tour-ring'));
  await p.screenshot({ path: `${OUT}/${label}-home-2.png` });
  await p.click('#tour-next'); await p.click('#tour-next'); await p.click('#tour-next');
  ok(`${label}: Done closes the tour`, !(await p.$('.tour')));
  await p.reload(); await p.waitForTimeout(500);
  ok(`${label}: tour does not come back after Done`, !(await p.$('.tour')));
  await p.click('#help'); ok(`${label}: ? replays the tour`, await p.isVisible('.tour-card'));
  await p.keyboard.press('Escape'); ok(`${label}: Escape closes it`, !(await p.$('.tour')));
  // GM board through a real room
  await p.click('#start'); await p.waitForSelector('#go'); await p.click('#go');
  await p.waitForSelector('.board', { timeout: 60000 }); await p.waitForSelector('.tour');
  const bn = Number((await p.textContent('#tour-count')).split(' of ')[1]);
  ok(`${label}: GM board tour opens with 8 steps (${bn})`, bn === 8);
  const titles = [];
  for (let i = 0; i < bn; i++) { titles.push(await p.textContent('#tour-title')); if (i === 3) await p.screenshot({ path: `${OUT}/${label}-board-share.png` }); if (i === 1) await p.screenshot({ path: `${OUT}/${label}-board-loop.png` }); await p.click("#tour-next"); await p.waitForTimeout(450); }
  ok(`${label}: board steps in order: ${titles.join(' / ')}`, titles.includes('Invite your players') && titles.includes('Who is listening'));
  ok(`${label}: board tour closes after the last step`, !(await p.$('.tour')));
  const room = new URL(p.url()).pathname.split('/r/')[1];
  // listener in a fresh context
  const lctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' });
  const l = await lctx.newPage(); l.on('pageerror', e => errs.push(e.message));
  await l.goto(U + 'r/' + room); await l.click('#go'); await l.waitForSelector('.listen', { timeout: 60000 }); await l.waitForSelector('.tour');
  const ln = Number((await l.textContent('#tour-count')).split(' of ')[1]);
  ok(`${label}: listener tour opens with 5 steps (${ln})`, ln === 5);
  await l.click('#tour-next'); await l.waitForTimeout(200); await l.screenshot({ path: `${OUT}/${label}-listen-2.png` });
  await l.click('#tour-skip'); ok(`${label}: Skip closes and remembers`, !(await l.$('.tour')) && await l.evaluate(() => localStorage.getItem('tour:listen:done')) === '1');
  // solo board: no share / listener steps
  const sctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' });
  const s = await sctx.newPage(); s.on('pageerror', e => errs.push(e.message));
  await s.goto(U + '?solo=1'); await s.click('#go'); await s.waitForSelector('.board', { timeout: 60000 }); await s.waitForSelector('.tour');
  const sn = Number((await s.textContent('#tour-count')).split(' of ')[1]);
  ok(`${label}: solo board tour drops the share and listener steps (${sn})`, sn === 6);
  await ctx.close(); await lctx.close(); await sctx.close();
}
ok('no page errors ' + errs.join(' | '), errs.length === 0);
await b.close(); srv.kill();
process.exit(fails ? 1 : 0);
