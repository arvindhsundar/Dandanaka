import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomStore } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 500);
const MAX_CLIENTS_PER_ROOM = Number(process.env.MAX_CLIENTS_PER_ROOM || 50);
// Mount point when the app lives under a path on a bigger site, e.g. BASE_PATH=/soundboard.
// The prefix is stripped from incoming URLs (so it works whether or not the proxy rewrites
// it away) and injected into index.html as <base href>, so every relative URL resolves.
const BASE_PATH = `/${process.env.BASE_PATH || ''}/`.replace(/\/+/g, '/');
function stripBase(p) {
  if (BASE_PATH === '/') return p;
  if (p === BASE_PATH.slice(0, -1)) return '/';
  return p.startsWith(BASE_PATH) ? p.slice(BASE_PATH.length - 1) : p;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const store = new RoomStore();
setInterval(() => store.sweep(), 60_000).unref();

// Very small per-IP limiter for room creation: 20 rooms per 10 minutes.
const creations = new Map();
function allowCreate(ip) {
  const now = Date.now();
  const list = (creations.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= 20) return false;
  list.push(now);
  creations.set(ip, list);
  return true;
}
setInterval(() => { for (const [ip, l] of creations) if (!l.length || Date.now() - l[l.length - 1] > 600_000) creations.delete(ip); }, 600_000).unref();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(req, res, filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const isAudio = type.startsWith('audio/');
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': isAudio ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  // Range support so <audio> elements and Safari behave.
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    let [start, end] = range.slice(6).split('-').map((s) => (s === '' ? NaN : Number(s)));
    if (Number.isNaN(start)) { start = stat.size - end; end = stat.size - 1; }
    if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start < 0 || start > end) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveIndex(req, res) {
  let html;
  try { html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'); } catch { res.writeHead(500); return res.end(); }
  html = html.replace('<base href="/">', `<base href="${BASE_PATH}">`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-length': Buffer.byteLength(html) });
  if (req.method === 'HEAD') return res.end();
  res.end(html);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = stripBase(url.pathname);

  if (p === '/healthz') return json(res, 200, { ok: true, rooms: store.size });

  if (p === '/api/rooms' && req.method === 'POST') {
    if (store.size >= MAX_ROOMS) return json(res, 503, { error: 'server is full, try again later' });
    if (!allowCreate(clientIp(req))) return json(res, 429, { error: 'too many rooms created, slow down' });
    const room = store.create();
    return json(res, 201, { code: room.code, gmToken: room.gmToken });
  }

  if (p.startsWith('/api/rooms/') && req.method === 'GET') {
    const room = store.get(p.slice('/api/rooms/'.length));
    if (!room) return json(res, 404, { error: 'no such room' });
    return json(res, 200, { code: room.code, listeners: room.listenerCount() });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  // /r/<code> is the app shell; the client reads the code from the URL.
  if (p === '/' || p.startsWith('/r/')) return serveIndex(req, res);

  const safe = path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC, safe);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (serveFile(req, res, filePath)) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (stripBase(url.pathname) !== '/ws') { socket.destroy(); return; }
  const room = store.get(url.searchParams.get('room') || '');
  if (!room) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  if (room.clients.size >= MAX_CLIENTS_PER_ROOM) { socket.write('HTTP/1.1 503 Room Full\r\n\r\n'); socket.destroy(); return; }
  const token = url.searchParams.get('token');
  const role = token && token === room.gmToken ? 'gm' : 'listener';
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, room, role));
});

function attach(ws, room, role) {
  const client = { role, send: (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  room.join(client);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') {
      // c = client send time; echoed back so the client can compute round trip + offset.
      client.send({ t: 'pong', c: msg.c, s: Date.now() });
      return;
    }
    const result = room.command(client, msg);
    if (!result.ok) client.send({ t: 'error', error: result.error, ref: msg.ref });
    else if (msg.ref !== undefined) client.send({ t: 'ack', ref: msg.ref, seq: result.seq });
  });

  ws.on('close', () => room.leave(client));
  ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
}

// Drop dead sockets (phones that vanished without a FIN).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`dandanaka listening on http://${HOST}:${server.address().port}${BASE_PATH}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`\n${sig}, shutting down`); wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
