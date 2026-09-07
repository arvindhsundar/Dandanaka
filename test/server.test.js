// Integration test: boots the real server on a random port, exercises HTTP + WebSocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

let proc, base;
const once = (ws, type) => new Promise((ok) => { const h = (d) => { const m = JSON.parse(d); if (m.t === type) { ws.off('message', h); ok(m); } }; ws.on('message', h); });
const open = (ws) => new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); ws.once('unexpected-response', (_, r) => err(new Error(`HTTP ${r.statusCode}`))); });

test.before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((ok) => proc.stdout.on('data', (d) => { const m = String(d).match(/:(\d+)\S*\s*$/m); if (m) ok(m[1]); }));
  base = `http://127.0.0.1:${port}`;
});
test.after(() => proc.kill());

test('serves the app shell, sounds, and manifest', async () => {
  const html = await (await fetch(`${base}/r/fox-moon-oak`)).text();
  assert.match(html, /<div id="app">/);
  const man = await (await fetch(`${base}/sounds/manifest.json`)).json();
  assert.ok(man.length >= 30);
  const head = await fetch(`${base}/${man[0].file}`, { headers: { range: 'bytes=0-99' } });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '100');
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test('room lifecycle over websocket', async () => {
  const { code, gmToken } = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  const wsBase = base.replace('http', 'ws');

  const gm = new WebSocket(`${wsBase}/ws?room=${code}&token=${gmToken}`);
  const gmState = once(gm, 'state'); await open(gm);
  assert.equal((await gmState).role, 'gm');

  const listener = new WebSocket(`${wsBase}/ws?room=${code}&token=wrong`);
  const lState = once(listener, 'state'); await open(listener);
  assert.equal((await lState).role, 'listener');

  // listener can't command
  const errP = once(listener, 'error');
  listener.send(JSON.stringify({ t: 'play', sound: 'thunder' }));
  assert.equal((await errP).error, 'not the GM');

  // ping/pong carries timestamps
  const pong = once(listener, 'pong');
  listener.send(JSON.stringify({ t: 'ping', c: 42 }));
  const p = await pong; assert.equal(p.c, 42); assert.ok(p.s > 1e12);

  // GM loop reaches the listener with a future timestamp
  const got = once(listener, 'loop');
  gm.send(JSON.stringify({ t: 'loop', sound: 'rain', on: true, volume: 0.5, ref: 7 }));
  const m = await got;
  assert.equal(m.sound, 'rain'); assert.ok(m.at > Date.now() - 50); assert.equal(m.startedAt, m.at);

  // late joiner sees the loop in state
  const late = new WebSocket(`${wsBase}/ws?room=${code}`);
  const lateState = once(late, 'state'); await open(late);
  const st = await lateState;
  assert.deepEqual(Object.keys(st.loops), ['rain']);
  assert.equal(st.listeners, 2);

  const info = await (await fetch(`${base}/api/rooms/${code}`)).json();
  assert.equal(info.listeners, 2);

  gm.close(); listener.close(); late.close();
});

test('unknown room is refused at upgrade', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=no-such-room`);
  await assert.rejects(open(ws), /HTTP 404/);
});

test('BASE_PATH mounts the whole app under a prefix', async () => {
  const p2 = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', BASE_PATH: '/soundboard' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((ok) => p2.stdout.on('data', (d) => { const m = String(d).match(/:(\d+)\S*\s*$/m); if (m) ok(m[1]); }));
    const b = `http://127.0.0.1:${port}`;
    const html = await (await fetch(`${b}/soundboard/r/fox-moon-oak`)).text();
    assert.match(html, /<base href="\/soundboard\/">/);
    assert.match(await (await fetch(`${b}/soundboard`)).text(), /<base href="\/soundboard\/">/);
    // also works when the proxy has already stripped the prefix
    assert.match(await (await fetch(`${b}/r/fox-moon-oak`)).text(), /<base href="\/soundboard\/">/);
    assert.equal((await fetch(`${b}/soundboard/sounds/manifest.json`)).status, 200);
    assert.equal((await fetch(`${b}/soundboard/styles.css`)).status, 200);
    const { code, gmToken } = await (await fetch(`${b}/soundboard/api/rooms`, { method: 'POST' })).json();
    const gm = new WebSocket(`ws://127.0.0.1:${port}/soundboard/ws?room=${code}&token=${gmToken}`);
    const st = once(gm, 'state'); await open(gm);
    assert.equal((await st).role, 'gm');
    gm.close();
  } finally { p2.kill(); }
});
