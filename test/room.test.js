import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomStore, makeCode, clampVolume, LEAD_MS, ROOM_TTL_MS } from '../server/room.js';

function fakeClient(role) {
  const c = { role, inbox: [], send(o) { c.inbox.push(o); } };
  return c;
}

test('room codes are three words', () => {
  assert.match(makeCode(), /^[a-z]+-[a-z]+-[a-z]+$/);
});

test('store creates unique rooms and looks them up case-insensitively', () => {
  const s = new RoomStore();
  const a = s.create(); const b = s.create();
  assert.notEqual(a.code, b.code);
  assert.equal(s.get(a.code.toUpperCase()), a);
  assert.equal(s.get('nope-nope-nope'), undefined);
});

test('listeners cannot issue commands', () => {
  const r = new Room('a-b-c', 'tok', () => 1000);
  const l = fakeClient('listener');
  r.join(l);
  assert.equal(r.command(l, { t: 'play', sound: 'thunder' }).ok, false);
  assert.equal(l.inbox.filter((m) => m.t === 'play').length, 0);
});

test('GM play is broadcast to everyone with a future timestamp and seq', () => {
  let now = 1000;
  const r = new Room('a-b-c', 'tok', () => now);
  const gm = fakeClient('gm'); const l = fakeClient('listener');
  r.join(gm); r.join(l);
  const res = r.command(gm, { t: 'play', sound: 'thunder', volume: 0.8 });
  assert.equal(res.ok, true);
  const got = l.inbox.find((m) => m.t === 'play');
  assert.deepEqual(got, { t: 'play', sound: 'thunder', volume: 0.8, at: 1000 + LEAD_MS, seq: 1 });
  assert.ok(gm.inbox.find((m) => m.t === 'play'));
});

test('loops are tracked in state so late joiners can catch up', () => {
  let now = 5000;
  const r = new Room('a-b-c', 'tok', () => now);
  const gm = fakeClient('gm'); r.join(gm);
  r.command(gm, { t: 'loop', sound: 'rain', on: true, volume: 0.5 });
  now = 9000;
  const late = fakeClient('listener'); r.join(late);
  const state = late.inbox.find((m) => m.t === 'state');
  assert.equal(state.now, 9000);
  assert.deepEqual(state.loops, { rain: { startedAt: 5000 + LEAD_MS, volume: 0.5 } });
  // re-sending loop on keeps the original start so it stays in phase
  r.command(gm, { t: 'loop', sound: 'rain', on: true, volume: 0.9 });
  assert.equal(r.loops.get('rain').startedAt, 5000 + LEAD_MS);
  assert.equal(r.loops.get('rain').volume, 0.9);
  r.command(gm, { t: 'loop', sound: 'rain', on: false });
  assert.equal(r.loops.size, 0);
});

test('stopAll clears loops; volume and master are clamped', () => {
  const r = new Room('a-b-c', 'tok', () => 0);
  const gm = fakeClient('gm'); r.join(gm);
  r.command(gm, { t: 'loop', sound: 'rain', on: true });
  r.command(gm, { t: 'loop', sound: 'wind', on: true });
  r.command(gm, { t: 'volume', sound: 'rain', volume: 99 });
  assert.equal(r.loops.get('rain').volume, 1.5);
  r.command(gm, { t: 'master', volume: -3 });
  assert.equal(r.master, 0);
  r.command(gm, { t: 'stopAll' });
  assert.equal(r.loops.size, 0);
  assert.equal(clampVolume('abc'), 1);
});

test('rejects bad sound ids and unknown commands', () => {
  const r = new Room('a-b-c', 'tok', () => 0);
  const gm = fakeClient('gm'); r.join(gm);
  assert.equal(r.command(gm, { t: 'play', sound: '../etc' }).ok, false);
  assert.equal(r.command(gm, { t: 'play', sound: 'Thunder' }).ok, false);
  assert.equal(r.command(gm, { t: 'dance' }).ok, false);
  assert.equal(r.command(gm, null).ok, false);
});

test('presence counts listeners only and expiry works', () => {
  let now = 0;
  const s = new RoomStore(() => now);
  const r = s.create();
  const gm = fakeClient('gm'); const a = fakeClient('listener'); const b = fakeClient('listener');
  r.join(gm); r.join(a); r.join(b);
  assert.equal(gm.inbox.at(-1).listeners, 2);
  r.leave(a); r.leave(b); r.leave(gm);
  now = ROOM_TTL_MS - 1; s.sweep(); assert.equal(s.size, 1);
  now = ROOM_TTL_MS + 1; s.sweep(); assert.equal(s.size, 0);
});
