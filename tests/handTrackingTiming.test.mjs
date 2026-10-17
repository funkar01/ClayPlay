import test from 'node:test';
import assert from 'node:assert/strict';
import { usableHandSample, currentHandPose } from '../src/handTrackingTiming.js';
import { PinchGesture } from '../src/pinchGesture.js';

test('Steady upstream delay is usable and does not trigger a tracking dropout between results', () => {
  for (const delay of [30, 190, 230, 350, 490]) {
    for (let now = 1000; now < 1600; now += 100) {
      assert.equal(usableHandSample(now - delay, now), true);
      assert.equal(currentHandPose(now, now + 99), true);
    }
  }
});

test('Unusable source frames and actual result stalls still stop editing', () => {
  for (const source of [500, -1000, NaN, Infinity, 1001]) assert.equal(usableHandSample(source, 1000), false);
  assert.equal(currentHandPose(1000, 1299), true);
  for (const now of [1300, 2000, NaN, Infinity, 999]) assert.equal(currentHandPose(1000, now), false);
});

test('An unambiguous pinch starts on its first frame and a clearly open frame releases immediately', () => {
  const points = Array.from({length:21}, () => ({x:.5,y:.5,z:0}));
  points[5].x = .45; points[17].x = .55; points[4].x = .51;
  const pinch = new PinchGesture();
  assert.equal(pinch.update(points, 1000), true);
  points[4].x = .56; assert.equal(pinch.update(points, 1033), false);
});
