import { AudioEngine } from '/audio.js';
import { ClockSync } from '/sync.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATEGORIES = [
  { id: 'ambience', name: 'Ambience', color: 'var(--amb)' },
  { id: 'combat', name: 'Combat', color: 'var(--cmb)' },
  { id: 'stingers', name: 'Stingers', color: 'var(--stg)' },
  { id: 'creatures', name: 'Creatures', color: 'var(--crt)' },
  { id: 'music', name: 'Music', color: 'var(--mus)' },
];

const S = {
  mode: null,           // 'gm' | 'listener' | 'solo'
  code: null, gmToken: null,
  manifest: [], missing: new Set(),
  connected: false, listeners: 0, roomMaster: 1,
  serverLoops: {},      // last known server loop state
  muted: false, localVolume: 1,
  lastError: '',
};
const engine = new AudioEngine();
const sync = new ClockSync();
let ws = null, reconnectDelay = 500, pingTimer = null, reconnectTimer = null, wakeLock = null;

// ---------- routing ----------
function route() {
  const m = location.pathname.match(/^\/r\/([a-z0-9-]+)/i);
  const q = new URLSearchParams(location.search);
  if (q.get('solo') === '1') { S.mode = 'solo'; return renderGate(); }
  if (!m) return renderHome();
  S.code = m[1].toLowerCase();
  S.gmToken = localStorage.getItem(`gm:${S.code}`);
  S.mode = S.gmToken ? 'gm' : 'listener';
  renderGate();
}

function renderHome() {
  app.innerHTML = `
    <div class="center">
      <h1>Dandanaka</h1>
      <p class="sub muted">A soundboard for the table. Start a session on this device, share the link, and every player hears the same thing at the same time.</p>
      <button class="primary" id="start">Start a session</button>
      <div class="row"><input type="text" id="code" placeholder="or enter a room code: fox-moon-oak" autocapitalize="none" autocorrect="off"><button id="join">Join</button></div>
      <p class="muted"><a href="/?solo=1">Solo board</a> (no room, this device only)</p>
      <p id="err" class="err"></p>
    </div>`;
  $('#start').onclick = async () => {
    $('#start').disabled = true; $('#err').textContent = '';
    try {
      const r = await fetch('/api/rooms', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      localStorage.setItem(`gm:${j.code}`, j.gmToken);
      location.href = `/r/${j.code}`;
    } catch (e) {
      $('#err').textContent = `Couldn't create a room (${e.message}). You can still use the solo board.`;
      $('#start').disabled = false;
    }
  };
  const go = () => { const c = $('#code').value.trim().toLowerCase().replace(/\s+/g, '-'); if (c) location.href = `/r/${c}`; };
  $('#join').onclick = go;
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// Every role passes through this tap so audio is unlocked by a real gesture.
function renderGate() {
  const isGm = S.mode !== 'listener';
  app.innerHTML = `
    <div class="center">
      <h1>${isGm ? 'Your soundboard' : 'Join the table'}</h1>
      ${S.code ? `<p class="muted">Room <b class="code">${esc(S.code)}</b></p>` : ''}
      <p class="sub muted">${isGm ? 'Tap to load the sounds and open the board.' : 'Tap once to allow audio on this device. Keep this tab open and your volume up.'}</p>
      <button class="primary" id="go">${isGm ? 'Open the board' : 'Tap to join audio'}</button>
      <div class="progress" id="prog" hidden><div></div></div>
      <p id="msg" class="muted"></p>
    </div>`;
  $('#go').onclick = async () => {
    $('#go').disabled = true;
    const ok = await engine.unlock();
    if (!ok) $('#msg').textContent = 'Audio is still locked. Tap again.';
    $('#prog').hidden = false;
    try {
      S.manifest = await (await fetch('/sounds/manifest.json')).json();
    } catch { $('#msg').textContent = 'Could not load the sound list. Check your connection and reload.'; return; }
    const failures = await engine.load(S.manifest, (d, t) => { $('#prog > div').style.width = `${(d / t) * 100}%`; $('#msg').textContent = `Loading sounds ${d}/${t}`; });
    for (const f of failures) S.missing.add(f.id);
    requestWakeLock();
    if (S.mode === 'listener') renderListener(); else renderBoard();
    if (S.mode !== 'solo') connect();
  };
}

// ---------- networking ----------
function wsUrl() {
  const u = new URL(location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws'; u.search = '';
  u.searchParams.set('room', S.code);
  if (S.gmToken) u.searchParams.set('token', S.gmToken);
  return u.toString();
}

function connect() {
  clearTimeout(reconnectTimer);
  try { ws = new WebSocket(wsUrl()); } catch { return scheduleReconnect(); }
  ws.onopen = () => {
    S.connected = true; reconnectDelay = 500; sync.reset();
    // burst of pings to lock the clock, then a slow heartbeat
    let n = 0;
    const burst = setInterval(() => { ping(); if (++n >= 8) clearInterval(burst); }, 120);
    clearInterval(pingTimer); pingTimer = setInterval(ping, 20_000);
    updateStatus();
  };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m); };
  ws.onclose = (ev) => {
    S.connected = false; clearInterval(pingTimer); updateStatus();
    if (ev.code === 1006 && S.mode === 'listener' && !S.lastError) S.lastError = '';
    scheduleReconnect();
  };
  ws.onerror = () => { /* onclose follows */ };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
}

function ping() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); }

const toLocal = (serverMs) => (sync.ready ? sync.toLocal(serverMs) : Date.now());

function handle(m) {
  switch (m.t) {
    case 'pong': sync.addSample(m.c, m.s, Date.now()); updateStatus(); break;
    case 'presence': S.listeners = m.listeners; updateStatus(); break;
    case 'error': S.lastError = m.error; toast(m.error); break;
    case 'ack': break;
    case 'state': onState(m); break;
    case 'play': engine.playOneShot(m.sound, m.volume, toLocal(m.at)); flash(m.sound); break;
    case 'loop':
      if (m.on) { engine.startLoop(m.sound, m.volume, toLocal(m.at), toLocal(m.startedAt)); S.serverLoops[m.sound] = { startedAt: m.startedAt, volume: m.volume }; }
      else { engine.stopLoop(m.sound, toLocal(m.at)); delete S.serverLoops[m.sound]; }
      updatePad(m.sound); updateNowPlaying(); break;
    case 'volume': engine.setLoopVolume(m.sound, m.volume); if (S.serverLoops[m.sound]) S.serverLoops[m.sound].volume = m.volume; updatePad(m.sound); break;
    case 'master': S.roomMaster = m.volume; engine.setRoomMaster(m.volume); updateMaster(); break;
    case 'stopAll': engine.stopAll(toLocal(m.at)); S.serverLoops = {}; refreshPads(); updateNowPlaying(); break;
  }
}

function onState(m) {
  S.listeners = m.listeners;
  const local = engine.activeLoops();
  if (S.mode === 'gm' && local.length) {
    // GM reconnected mid-session with loops running: GM's board wins.
    for (const l of local) if (!m.loops[l.id]) send({ t: 'loop', sound: l.id, on: true, volume: l.volume });
    for (const id of Object.keys(m.loops)) if (!local.find((l) => l.id === id)) send({ t: 'loop', sound: id, on: false });
    send({ t: 'master', volume: S.roomMaster });
    updateStatus();
    return;
  }
  S.serverLoops = m.loops;
  S.roomMaster = m.master; engine.setRoomMaster(m.master);
  const now = Date.now();
  for (const l of local) if (!m.loops[l.id]) engine.stopLoop(l.id, now);
  for (const [id, l] of Object.entries(m.loops)) engine.startLoop(id, l.volume, now, sync.ready ? sync.toLocal(l.startedAt) : now - (m.now - l.startedAt));
  refreshPads(); updateMaster(); updateNowPlaying(); updateStatus();
}

// GM commands: go through the server when connected (so everyone, including this
// device, plays off the same clock), otherwise apply locally so the table never goes silent.
function send(cmd) {
  if (S.mode !== 'solo' && ws && ws.readyState === 1) { ws.send(JSON.stringify(cmd)); return; }
  const at = Date.now() + 40;
  switch (cmd.t) {
    case 'play': engine.playOneShot(cmd.sound, cmd.volume ?? 1, at); flash(cmd.sound); break;
    case 'loop': if (cmd.on) engine.startLoop(cmd.sound, cmd.volume ?? 1, at); else engine.stopLoop(cmd.sound, at); updatePad(cmd.sound); break;
    case 'volume': engine.setLoopVolume(cmd.sound, cmd.volume); break;
    case 'master': S.roomMaster = cmd.volume; engine.setRoomMaster(cmd.volume); break;
    case 'stopAll': engine.stopAll(at); refreshPads(); break;
  }
}

// ---------- GM board ----------
function renderBoard() {
  const byCat = new Map(CATEGORIES.map((c) => [c.id, []]));
  for (const s of S.manifest) (byCat.get(s.category) || byCat.set(s.category, []).get(s.category)).push(s);
  app.innerHTML = `
    <div class="top">
      ${S.code ? `<span class="code">${esc(S.code)}</span><button class="ghost" id="share">Share link</button>` : '<span class="code">Solo board</span>'}
      <span class="status"><span class="dot" id="dot"></span><span id="stat"></span></span>
      <span class="spacer"></span>
      <label class="master">Master <input type="range" id="master" min="0" max="1.5" step="0.01" value="${S.roomMaster}"></label>
      <button class="stopall" id="stopall">Stop all</button>
    </div>
    <div class="banner" id="banner" hidden>Audio paused by the browser. Tap to resume.</div>
    <div class="board">
      ${CATEGORIES.filter((c) => byCat.get(c.id)?.length).map((c) => `
        <section class="cat" style="--c:${c.color}"><h2>${c.name}</h2><div class="grid">
          ${byCat.get(c.id).map(padHtml).join('')}
        </div></section>`).join('')}
    </div>
    ${creditsHtml()}`;
  $('#stopall').onclick = () => send({ t: 'stopAll' });
  $('#master').oninput = (e) => send({ t: 'master', volume: Number(e.target.value) });
  if ($('#share')) $('#share').onclick = shareLink;
  $('#banner').onclick = () => engine.resume();
  for (const pad of app.querySelectorAll('.pad')) {
    const id = pad.dataset.id;
    const isLoop = pad.classList.contains('loop');
    pad.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (S.missing.has(id)) return toast('That sound failed to load.');
      if (isLoop) send({ t: 'loop', sound: id, on: !engine.loops.has(id), volume: Number(pad.querySelector('input').value) });
      else send({ t: 'play', sound: id, volume: 1 });
    });
    const vol = pad.querySelector('input');
    if (vol) vol.addEventListener('input', () => send({ t: 'volume', sound: id, volume: Number(vol.value) }));
  }
  updateStatus(); refreshPads();
}

function padHtml(s) {
  const loop = s.kind === 'loop';
  return `<button class="pad ${loop ? 'loop' : 'shot'} ${S.missing.has(s.id) ? 'missing' : ''}" data-id="${esc(s.id)}">
    <span class="name">${esc(s.name)}</span>
    <span class="kind">${loop ? 'loop' : 'one-shot'}</span>
    ${loop ? `<input class="vol" type="range" min="0" max="1.5" step="0.01" value="${s.defaultVolume ?? 0.8}">` : ''}
  </button>`;
}

function updatePad(id) {
  const pad = app.querySelector(`.pad[data-id="${CSS.escape(id)}"]`);
  if (!pad) return;
  const l = engine.loops.get(id);
  pad.classList.toggle('on', !!l);
  const vol = pad.querySelector('input');
  if (vol && l && document.activeElement !== vol) vol.value = l.volume;
}
function refreshPads() { for (const p of app.querySelectorAll('.pad')) updatePad(p.dataset.id); }
function flash(id) {
  const pad = app.querySelector(`.pad[data-id="${CSS.escape(id)}"]`);
  if (!pad) return;
  pad.classList.add('flash'); setTimeout(() => pad.classList.remove('flash'), 250);
}
function updateMaster() { const m = $('#master'); if (m && document.activeElement !== m) m.value = S.roomMaster; }

async function shareLink() {
  const url = `${location.origin}/r/${S.code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Join my table', text: `Room code ${S.code}`, url }); return; } catch { /* cancelled */ } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Share this link', url); }
}

// ---------- listener ----------
function renderListener() {
  app.innerHTML = `
    <div class="top">
      <span class="code">${esc(S.code)}</span>
      <span class="status"><span class="dot" id="dot"></span><span id="stat"></span></span>
    </div>
    <div class="banner" id="banner" hidden>Audio paused by the browser. Tap to resume.</div>
    <div class="listen">
      <div class="card"><h3>Now playing</h3><div class="now" id="now"><span class="muted">Nothing yet. Waiting on the GM.</span></div></div>
      <div class="card"><h3>Your volume</h3>
        <input type="range" id="lvol" min="0" max="1" step="0.01" value="${S.localVolume}">
        <p><button id="mute" class="ghost">Mute</button></p>
      </div>
      <p class="muted">Keep this tab in the foreground. Phones stop playing web audio when the screen locks or the tab is hidden.</p>
    </div>
    ${creditsHtml()}`;
  $('#lvol').oninput = (e) => { S.localVolume = Number(e.target.value); if (!S.muted) engine.setLocalVolume(S.localVolume); };
  $('#mute').onclick = () => { S.muted = !S.muted; engine.setLocalVolume(S.muted ? 0 : S.localVolume); $('#mute').textContent = S.muted ? 'Unmute' : 'Mute'; };
  $('#banner').onclick = () => engine.resume();
  updateStatus(); updateNowPlaying();
}

function updateNowPlaying() {
  const el = $('#now'); if (!el) return;
  const loops = engine.activeLoops();
  if (!loops.length) { el.innerHTML = '<span class="muted">Nothing playing.</span>'; return; }
  el.innerHTML = loops.map((l) => `<span class="chip on">${esc(nameOf(l.id))}</span>`).join('');
}
function nameOf(id) { const s = S.manifest.find((x) => x.id === id); return s ? s.name : id; }

// ---------- shared ----------
function updateStatus() {
  const dot = $('#dot'), stat = $('#stat'); if (!dot || !stat) return;
  if (S.mode === 'solo') { dot.className = 'dot'; stat.textContent = 'local only'; return; }
  if (!S.connected) { dot.className = 'dot bad'; stat.textContent = S.mode === 'gm' ? 'offline: playing locally, reconnecting…' : 'reconnecting…'; return; }
  dot.className = sync.ready ? 'dot ok' : 'dot warn';
  const l = S.mode === 'gm' ? `${S.listeners} listener${S.listeners === 1 ? '' : 's'}` : 'connected';
  stat.textContent = sync.ready ? `${l} · ${Math.round(sync.rtt)}ms` : `${l} · syncing clock`;
}

let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'notice'; t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

function creditsHtml() {
  const items = S.manifest.filter((s) => s.source).map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.source.title || '')} by ${esc(s.source.author || 'unknown')}${s.source.url ? ` (<a href="${esc(s.source.url)}" target="_blank" rel="noopener">source</a>)` : ''}, ${esc(s.source.license || '')}</li>`);
  return `<details class="credits"><summary>Sound credits</summary><ul>${items.join('')}</ul></details>`;
}

async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed, fine */ }
}

engine.onStateChange = (st) => { const b = $('#banner'); if (b) b.hidden = st === 'running'; };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { engine.resume(); requestWakeLock(); if (S.mode !== 'solo' && (!ws || ws.readyState > 1)) connect(); }
});
window.addEventListener('online', () => { if (S.mode !== 'solo' && (!ws || ws.readyState > 1)) connect(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();

// Debug handle for automated tests and console poking. Harmless in production.
window.__dd = { engine, sync, S };
