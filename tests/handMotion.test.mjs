import test from 'node:test';
import assert from 'node:assert/strict';
import { HandMotion } from '../src/handMotion.js';

const hand = x => Array.from({ length: 21 }, (_, i) => ({ x: x + i * .001, y: .5, z: 0 }));
const rms = values => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);

test('A stationary fingertip rejects camera jitter without a dead zone', t => {
  const motion = new HandMotion();
  const raw = [], filtered = [];
  for (let i = 0; i < 120; i++) {
    const noise = (i % 2 ? 1 : -1) * .002;
    const value = motion.update(hand(.5 + noise), i * 1000 / 30);
    if (i > 20) { raw.push(noise); filtered.push(value[8].x - .508); }
  }
  assert.ok(rms(filtered) < rms(raw) * .45, 'Resting jitter should fall by more than half');
  t.diagnostic(`Synthetic alternating jitter: RMS reduced by ${(100 * (1 - rms(filtered) / rms(raw))).toFixed(1)}%`);
  const baseline = motion.value[8].x;
  for (let i = 120; i < 150; i++) motion.update(hand(.501), i * 1000 / 30);
  assert.ok(motion.value[8].x > baseline, 'Small intentional movement must not stick in a deadband');
});

test('Intentional motion trails less than the old two-stage pipeline at 30 and 60 Hz', t => {
  for (const hz of [30, 60]) {
    const motion = new HandMotion(), dt = 1000 / hz;
    let oldLandmark = .508, oldDisplay = .508;
    const oldErrors = [], newErrors = [];
    for (let now = 0; now <= 1000; now += 1000 / 120) {
      if (Math.round(now / (1000 / 120)) % (120 / hz) === 0) {
        const x = .5 + now / 1000 * .4;
        motion.update(hand(x), now);
        oldLandmark += (x + .008 - oldLandmark) * (1 - Math.exp(-dt / 25));
      }
      oldDisplay += (oldLandmark - oldDisplay) * (1 - Math.exp(-(1000 / 120) / 12));
      if (now > 200) {
        const actual = .508 + now / 1000 * .4;
        oldErrors.push(Math.abs(actual - oldDisplay));
        newErrors.push(Math.abs(actual - motion.sample(now)[8].x));
      }
    }
    const before = oldErrors.reduce((a, b) => a + b) / oldErrors.length;
    const after = newErrors.reduce((a, b) => a + b) / newErrors.length;
    assert.ok(after < before * .65, `${hz} Hz: ${after} should beat ${before}`);
    t.diagnostic(`${hz} Hz, synthetic constant-speed movement: mean position error ${(before * 1000).toFixed(2)} → ${(after * 1000).toFixed(2)} normalized thousandths`);
  }
});

test('Visual prediction is bounded; editing samples never advance beyond a measurement', () => {
  const motion = new HandMotion({ staleMs: 200 });
  motion.update(hand(.2), 0); motion.update(hand(.24), 33); motion.update(hand(.28), 66);
  const measured = motion.sample(66, { predict: false });
  const p = motion.sample(110);
  assert.ok(p[8].x > measured[8].x);
  assert.ok(p[8].x - measured[8].x <= .015 + 1e-9);
  assert.deepEqual(motion.sample(160), p, 'Missing frames must not cause continued drift');
  assert.deepEqual(motion.sample(160, { predict: false }), measured);
  assert.deepEqual(motion.sample(300), measured, 'Stale samples must stop extrapolating');
});

test('Stops, reversals, dropouts and invalid input do not retain forward prediction', () => {
  const motion = new HandMotion();
  motion.update(hand(.2), 0); motion.update(hand(.23), 33); motion.update(hand(.23), 66);
  assert.equal(motion.sample(80)[8].x, motion.value[8].x, 'Stop removes forward velocity immediately');
  motion.update(hand(.21), 99);
  assert.ok(motion.sample(110)[8].x <= motion.value[8].x, 'Reversal must not predict in the old direction');
  assert.deepEqual(motion.update(hand(.8), 500), hand(.8), 'Reacquisition starts at the new hand');
  const value = motion.sample(500);
  assert.deepEqual(motion.update(hand(.1), 499), value, 'Out-of-order samples cannot move the hand');
  const bad = hand(.2); bad[8].x = NaN;
  assert.equal(motion.update(bad, 533), null); assert.equal(motion.sample(540), null);
  assert.deepEqual(motion.update(hand(.3), 566), hand(.3));
});

test('Slow inference does not exhaust the motion between display frames before a result arrives', () => {
  const motion = new HandMotion({ staleMs: 200 });
  motion.update(hand(.2), 0, 40); motion.update(hand(.22), 33, 73); motion.update(hand(.24), 66, 106);
  const atArrival = motion.sample(106)[8].x;
  const nextDisplay = motion.sample(114)[8].x;
  const followingDisplay = motion.sample(122)[8].x;
  assert.ok(atArrival < nextDisplay && nextDisplay < followingDisplay,
    'Pointer should advance on display frames even when inference takes longer than the prediction horizon');
  assert.deepEqual(motion.sample(140), motion.sample(160), 'Bounded prediction still stops advancing');
});
