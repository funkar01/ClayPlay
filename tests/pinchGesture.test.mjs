import test from 'node:test';
import assert from 'node:assert/strict';
import { PinchGesture } from '../src/pinchGesture.js';

function hand(ratio, {aspect = 1, scale = 1, angle = 0, mirror = 1} = {}) {
  const points = Array.from({length:21}, () => ({x:0,y:0,z:0}));
  points[5].x = -.05; points[17].x = .05; points[4].x = ratio * .1;
  return points.map(({x,y,z}) => ({
    x:.5 + scale * (x * mirror * Math.cos(angle) - y * Math.sin(angle)) / aspect,
    y:.5 + scale * (x * mirror * Math.sin(angle) + y * Math.cos(angle)), z,
  }));
}

test('A tight pinch releases on the first modest opening, without waiting for a wide-open hand', () => {
  const gesture = new PinchGesture();
  assert.equal(gesture.update(hand(.08), 0), true);
  assert.equal(gesture.update(hand(.38), 33), false);
});

test('Release sensitivity adapts to a looser pinch and tightens when the fingers close further', () => {
  const gesture = new PinchGesture();
  assert.equal(gesture.update(hand(.33), 0), true);
  for (const [time, ratio] of [[33,.38],[66,.44]]) assert.equal(gesture.update(hand(ratio), time), true);
  assert.equal(gesture.update(hand(.49), 99), false);
  assert.equal(gesture.update(hand(.28), 132), true);
  assert.equal(gesture.update(hand(.08), 165), true);
  assert.equal(gesture.update(hand(.38), 198), false);
});

test('Normal closed-finger jitter does not interrupt a held stroke', () => {
  const gesture = new PinchGesture(); gesture.update(hand(.08), 0);
  for (const [i, ratio] of [.12,.24,.18,.30,.14,.32,.20].entries()) {
    const points = hand(ratio); points[4].z = i; points[8].z = -i;
    assert.equal(gesture.update(points, (i+1)*33), true);
  }
});

test('Partial opening or threshold jitter after release cannot grab again', () => {
  const gesture = new PinchGesture(); gesture.update(hand(.08), 0);
  assert.equal(gesture.update(hand(.38), 33), false);
  for (const [i, ratio] of [.37,.33,.39,.31,.35,.40,.33,.33,.33].entries()) {
    assert.equal(gesture.update(hand(ratio), (i+2)*33), false);
  }
  assert.equal(gesture.update(hand(.10), 400), true, 'A deliberate fresh pinch grabs immediately');
});

test('A borderline first pinch still confirms briefly; its release needs no confirmation', () => {
  const gesture = new PinchGesture();
  assert.equal(gesture.update(hand(.39), 0), false);
  assert.equal(gesture.update(hand(.39), 16), false);
  assert.equal(gesture.update(hand(.39), 33), true);
  assert.equal(gesture.update(hand(.49), 34), false);
});

test('Quick release is independent of frame rate, palm scale, rotation and handedness', () => {
  for (const step of [16,33,100,230]) for (const aspect of [1,1.78]) {
    for (const scale of [.5,1,1.8]) for (const angle of [-.7,0,.7]) for (const mirror of [-1,1]) {
      const options = {aspect,scale,angle,mirror}, gesture = new PinchGesture();
      assert.equal(gesture.update(hand(.1,options), 0,aspect), true);
      assert.equal(gesture.update(hand(.38,options), step,aspect), false);
    }
  }
});

test('A brief missing detection preserves the grip, and an opening on recovery releases it immediately', () => {
  const gesture = new PinchGesture(); gesture.update(hand(.1), 0);
  gesture.uncertain(); assert.equal(gesture.held,true);
  assert.equal(gesture.update(hand(.38), 230), false);
});
