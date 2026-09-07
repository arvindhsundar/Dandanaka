import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync } from '../public/sync.js';

test('estimates offset from symmetric samples', () => {
  const s = new ClockSync();
  const trueOffset = 1234;
  for (let i = 0; i < 6; i++) {
    const send = 1000 + i * 100; const rtt = 80 + (i % 3) * 20;
    s.addSample(send, send + rtt / 2 + trueOffset, send + rtt);
  }
  assert.equal(s.offset, trueOffset);
  assert.equal(s.ready, true);
  assert.equal(s.serverNow(5000), 5000 + trueOffset);
  assert.equal(s.toLocal(6234), 5000);
});

test('prefers low-latency samples over noisy ones', () => {
  const s = new ClockSync();
  // three clean samples, three with big asymmetric delay that would skew a plain average
  for (let i = 0; i < 3; i++) s.addSample(0, 500 + 25, 50);
  for (let i = 0; i < 3; i++) s.addSample(0, 500 + 900, 1000);
  assert.equal(s.offset, 500);
});

test('ignores negative round trips', () => {
  const s = new ClockSync();
  s.addSample(100, 100, 50);
  assert.equal(s.samples.length, 0);
});
