// Pure room logic. No sockets in here so it can be unit tested.
import { randomBytes, randomInt } from 'node:crypto';
import { WORDS } from './words.js';

export const LEAD_MS = 300;            // how far ahead commands are scheduled
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // empty room lifetime
export const MAX_VOLUME = 1.5;

export function makeCode(rng = randomInt) {
  const pick = () => WORDS[rng(WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

export function makeToken() {
  return randomBytes(18).toString('base64url');
}

export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_VOLUME, Math.max(0, n));
}

export class Room {
  constructor(code, gmToken, now = Date.now) {
    this.code = code;
    this.gmToken = gmToken;
    this.now = now;
    this.seq = 0;
    this.createdAt = now();
    this.lastActivity = now();
    this.master = 1;
    this.loops = new Map();   // soundId -> { startedAt, volume }
    this.clients = new Set(); // { role, send(obj) }
  }

  snapshot() {
    const loops = {};
    for (const [id, l] of this.loops) loops[id] = { startedAt: l.startedAt, volume: l.volume };
    return { now: this.now(), master: this.master, loops, listeners: this.listenerCount() };
  }

  listenerCount() {
    let n = 0;
    for (const c of this.clients) if (c.role === 'listener') n++;
    return n;
  }

  join(client) {
    this.clients.add(client);
    this.lastActivity = this.now();
    client.send({ t: 'state', ...this.snapshot(), role: client.role });
    this.broadcastPresence();
  }

  leave(client) {
    this.clients.delete(client);
    this.lastActivity = this.now();
    this.broadcastPresence();
  }

  isEmpty() { return this.clients.size === 0; }
  isExpired() { return this.isEmpty() && this.now() - this.lastActivity > ROOM_TTL_MS; }

  broadcast(obj) {
    for (const c of this.clients) {
      try { c.send(obj); } catch { /* socket closing, ignore */ }
    }
  }

  broadcastPresence() {
    this.broadcast({ t: 'presence', listeners: this.listenerCount() });
  }

  // Returns { ok, error } so the transport can report back to the GM.
  command(client, msg) {
    if (client.role !== 'gm') return { ok: false, error: 'not the GM' };
    if (!msg || typeof msg !== 'object') return { ok: false, error: 'bad message' };
    const sound = typeof msg.sound === 'string' && /^[a-z0-9-]{1,64}$/.test(msg.sound) ? msg.sound : null;
    const at = this.now() + LEAD_MS;
    let out;
    switch (msg.t) {
      case 'play':
        if (!sound) return { ok: false, error: 'bad sound id' };
        out = { t: 'play', sound, volume: clampVolume(msg.volume ?? 1), at };
        break;
      case 'loop': {
        if (!sound) return { ok: false, error: 'bad sound id' };
        const volume = clampVolume(msg.volume ?? 1);
        if (msg.on) {
          const existing = this.loops.get(sound);
          const startedAt = existing ? existing.startedAt : at;
          this.loops.set(sound, { startedAt, volume });
          out = { t: 'loop', sound, on: true, volume, at, startedAt };
        } else {
          this.loops.delete(sound);
          out = { t: 'loop', sound, on: false, at };
        }
        break;
      }
      case 'volume': {
        if (!sound) return { ok: false, error: 'bad sound id' };
        const volume = clampVolume(msg.volume);
        const l = this.loops.get(sound);
        if (l) l.volume = volume;
        out = { t: 'volume', sound, volume, at };
        break;
      }
      case 'master':
        this.master = clampVolume(msg.volume);
        out = { t: 'master', volume: this.master, at };
        break;
      case 'stopAll':
        this.loops.clear();
        out = { t: 'stopAll', at };
        break;
      default:
        return { ok: false, error: `unknown command ${String(msg.t)}` };
    }
    out.seq = ++this.seq;
    this.lastActivity = this.now();
    this.broadcast(out);
    return { ok: true, seq: out.seq };
  }
}

export class RoomStore {
  constructor(now = Date.now) {
    this.rooms = new Map();
    this.now = now;
  }
  create() {
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new Room(code, makeToken(), this.now);
    this.rooms.set(code, room);
    return room;
  }
  get(code) { return this.rooms.get(String(code).toLowerCase()); }
  sweep() {
    for (const [code, room] of this.rooms) if (room.isExpired()) this.rooms.delete(code);
  }
  get size() { return this.rooms.size; }
}
