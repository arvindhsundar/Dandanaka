// Web Audio engine: preload + decode every sound, play one-shots and gapless loops
// at a scheduled AudioContext time. Handles the mobile unlock dance.

const LOOP_XFADE_SEC = 0.5;
const LOOP_FADE_IN = 0.8;
const LOOP_FADE_OUT = 0.6;

function makeLoopable(ctx, buf, xf = LOOP_XFADE_SEC) {
  const n = Math.min(Math.floor(xf * buf.sampleRate), Math.floor(buf.length / 4));
  if (n < 64) return buf;
  const outLen = buf.length - n;
  const out = ctx.createBuffer(buf.numberOfChannels, outLen, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    const plain = outLen - n;
    dst.set(src.subarray(n, n + plain), 0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = Math.cos(t * Math.PI / 2), b = Math.sin(t * Math.PI / 2);
      dst[plain + i] = src[plain + n + i] * a + src[i] * b;
    }
  }
  return out;
}

function silentWavUrl() {
  // 1 second of silence, 8kHz mono 8-bit. Used to pin iOS into "playback" mode
  // so Web Audio keeps playing with the ring/silent switch on.
  const rate = 8000, len = rate;
  const b = new ArrayBuffer(44 + len);
  const v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, len, true);
  new Uint8Array(b, 44).fill(128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();     // id -> AudioBuffer
    this.meta = new Map();        // id -> manifest entry
    this.loops = new Map();       // id -> { src, gain, volume }
    this.unlocked = false;
    this.roomMaster = 1;
    this.localVolume = 1;
    this.keepAlive = null;
    this.onStateChange = null;
  }

  get state() { return this.ctx ? this.ctx.state : 'none'; }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.masterGain = this.ctx.createGain();
    this.localGain = this.ctx.createGain();
    this.masterGain.connect(this.localGain).connect(this.ctx.destination);
    this.masterGain.gain.value = this.roomMaster;
    this.localGain.gain.value = this.localVolume;
    this.ctx.onstatechange = () => this.onStateChange && this.onStateChange(this.ctx.state);
    return this.ctx;
  }

  // Must be called from a user gesture (tap/click) on mobile.
  async unlock() {
    const ctx = this.ensureContext();
    try { await ctx.resume(); } catch { /* retried on next gesture */ }
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
    if (!this.keepAlive) {
      const a = new Audio(silentWavUrl());
      a.loop = true; a.volume = 0.01; a.setAttribute('playsinline', '');
      a.play().catch(() => {});
      this.keepAlive = a;
    }
    this.unlocked = ctx.state === 'running';
    return this.unlocked;
  }

  async resume() {
    if (!this.ctx) return false;
    try { await this.ctx.resume(); } catch { /* ignore */ }
    if (this.keepAlive && this.keepAlive.paused) this.keepAlive.play().catch(() => {});
    return this.ctx.state === 'running';
  }

  async load(manifest, onProgress) {
    const ctx = this.ensureContext();
    let done = 0;
    const total = manifest.length;
    const failures = [];
    // Limited concurrency so phones on 4G don't choke.
    const queue = [...manifest];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        this.meta.set(s.id, s);
        try {
          const res = await fetch(s.file);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = await res.arrayBuffer();
          let buf = await new Promise((ok, err) => ctx.decodeAudioData(raw, ok, err));
          if (s.kind === 'loop') buf = makeLoopable(ctx, buf);
          this.buffers.set(s.id, buf);
        } catch (e) {
          failures.push({ id: s.id, error: String(e) });
        }
        done++;
        onProgress && onProgress(done, total);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return failures;
  }

  duration(id) { const b = this.buffers.get(id); return b ? b.duration : 0; }

  // Convert an absolute local-clock ms timestamp into AudioContext time.
  whenFor(localAtMs) {
    const ctx = this.ensureContext();
    const delta = (localAtMs - Date.now()) / 1000;
    // Slightly late commands still play right now rather than being dropped.
    return ctx.currentTime + Math.max(0, delta);
  }

  gainFor(id, volume) {
    const m = this.meta.get(id);
    return (m && m.gain ? m.gain : 1) * volume;
  }

  playOneShot(id, volume = 1, localAtMs = Date.now()) {
    const buf = this.buffers.get(id);
    if (!buf) return false;
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = this.gainFor(id, volume);
    src.buffer = buf;
    src.connect(g).connect(this.masterGain);
    src.start(this.whenFor(localAtMs));
    return true;
  }

  // startedLocalMs: when this loop originally started (local clock), used so late
  // joiners land at the same position in the file as everyone else.
  startLoop(id, volume = 1, localAtMs = Date.now(), startedLocalMs = localAtMs) {
    const buf = this.buffers.get(id);
    if (!buf) return false;
    if (this.loops.has(id)) { this.setLoopVolume(id, volume); return true; }
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain();
    const when = this.whenFor(localAtMs);
    const target = this.gainFor(id, volume);
    const elapsed = Math.max(0, (localAtMs - startedLocalMs) / 1000);
    const offset = elapsed % buf.duration;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(target, 0.0001), when + LOOP_FADE_IN);
    src.connect(g).connect(this.masterGain);
    src.start(when, offset);
    this.loops.set(id, { src, gain: g, volume });
    return true;
  }

  stopLoop(id, localAtMs = Date.now()) {
    const l = this.loops.get(id);
    if (!l) return;
    const when = this.whenFor(localAtMs);
    const cur = Math.max(l.gain.gain.value, 0.0001);
    l.gain.gain.cancelScheduledValues(when);
    l.gain.gain.setValueAtTime(cur, when);
    l.gain.gain.exponentialRampToValueAtTime(0.0001, when + LOOP_FADE_OUT);
    try { l.src.stop(when + LOOP_FADE_OUT + 0.05); } catch { /* already stopped */ }
    this.loops.delete(id);
  }

  setLoopVolume(id, volume) {
    const l = this.loops.get(id);
    if (!l) return;
    l.volume = volume;
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setTargetAtTime(this.gainFor(id, volume), t, 0.05);
  }

  setRoomMaster(v) {
    this.roomMaster = v;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setLocalVolume(v) {
    this.localVolume = v;
    if (this.localGain) this.localGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  stopAll(localAtMs = Date.now()) {
    for (const id of [...this.loops.keys()]) this.stopLoop(id, localAtMs);
  }

  activeLoops() { return [...this.loops.entries()].map(([id, l]) => ({ id, volume: l.volume })); }
}
