import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { closedFist, palmCenter, TwoHandScale, handTrackingBudget } from '../src/twoHandScale.js';
import { checkpoint, checkpointScale, applyMaskScale, restoreHistory } from '../src/sculptHistory.js';
import { ClayObjects } from '../src/clayObjects.js';
import { ClayVolume } from '../src/clayVolume.js';

function hand(x, closed = true) {
  const p = Array.from({ length: 21 }, () => ({ x, y: .5, z: 0 }));
  p[0].y = .65;
  for (const [joint, tip, dx] of [[6,8,-.04], [10,12,0], [14,16,.04], [18,20,.08]]) {
    p[joint] = { x: x + dx, y: .42, z: 0 };
    p[tip] = { x: x + dx, y: closed ? .55 : .3, z: 0 };
  }
  return p;
}

test('Fist detector accepts curled fingers and rejects an open hand or a sculpting pinch', () => {
  for (const aspect of [1, 1.78]) {
    assert.equal(closedFist(hand(.3), aspect), true);
    assert.equal(closedFist(hand(.3, false), aspect), false);
    const pinch = hand(.3, false); pinch[8].y = .55; pinch[4] = { ...pinch[8] };
    assert.equal(closedFist(pinch, aspect), false);
  }
  assert.equal(closedFist([]), false);
  const invalid = hand(.3); invalid[9].x = NaN;
  assert.equal(palmCenter(invalid), null); assert.equal(closedFist(invalid), false);
});

test('Both fists must settle before scaling; hand order changes do not change size', () => {
  const scale = new TwoHandScale(), pair = [hand(.3), hand(.7)];
  assert.equal(scale.update(pair, 0, 1, 1, false).phase, 'waiting');
  assert.equal(scale.update(pair, 10, 1).phase, 'ready');
  assert.equal(scale.update(pair, 100, 1).phase, 'ready');
  assert.equal(scale.update(pair, 130, 1).started, true);
  const larger = scale.update([hand(.8), hand(.2)], 230, 1);
  assert.ok(larger.scale > 1.4 && larger.scale < 1.5);
  const smaller = scale.update([hand(.4), hand(.6)], 330, larger.scale);
  assert.ok(smaller.scale < .65);
});

test('Opening either fist or losing a hand immediately freezes size and requires a fresh baseline', () => {
  for (const released of [[hand(.1, false), hand(.9)], [hand(.1), hand(.9, false)], [hand(.1)], []]) {
    const scale = new TwoHandScale();
    scale.update([hand(.3), hand(.7)], 0, 1); scale.update([hand(.3), hand(.7)], 120, 1);
    const moved = scale.update([hand(.2), hand(.8)], 220, 1).scale;
    const end = scale.update(released, 250, moved);
    assert.equal(end.finished, true); assert.equal(end.scale, moved); assert.equal(scale.active, false);
    const next = scale.update([hand(.1), hand(.9)], 300, moved);
    assert.equal(next.phase, 'ready'); assert.equal(next.scale, moved);
    assert.equal(scale.update([hand(.1), hand(.9)], 420, moved).scale, moved);
  }
});

test('Scaling clamps extremes and rejects tiny grip distances', () => {
  const scale = new TwoHandScale();
  assert.equal(scale.update([hand(.49), hand(.51)], 0, 1).phase, 'waiting');
  scale.update([hand(.4), hand(.6)], 20, 1); scale.update([hand(.4), hand(.6)], 140, 1);
  assert.equal(scale.update([hand(0), hand(1)], 240, 1).scale, 2.5);
  scale.reset(); scale.update([hand(.1), hand(.9)], 0, 1); scale.update([hand(.1), hand(.9)], 120, 1);
  assert.equal(scale.update([hand(.45), hand(.55)], 220, 1).scale, .4);
});

test('One-hand budget is unchanged; automatic two-hand tracking reaches 30 Hz and backs off on slow inference', () => {
  assert.deepEqual(handTrackingBudget(1, 150), { width: 640, interval: 0 });
  assert.deepEqual(handTrackingBudget(2, 10), { width: 512, interval: 33 });
  assert.deepEqual(handTrackingBudget(2, 80), { width: 512, interval: 88 });
  assert.deepEqual(handTrackingBudget(2, 500), { width: 512, interval: 200 });
});

test('Size undo/redo shares geometry, skips remeshing, and stays correct when mixed with sculpt history', t => {
  globalThis.document = { dispatchEvent() {} }; t.after(() => { delete globalThis.document; });
  const group = new THREE.Group(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, .1,0,0, 0,.1,0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); group.add(mesh);
  const volume = ClayVolume.fromState({ shape: 'full', field: [] });
  Object.assign(volume, { parent: group, material: mesh.material, bricks: new Map([['0,0,0',{mesh}]]), layoutScale: .8 });
  applyMaskScale(volume, 1); checkpointScale(volume); applyMaskScale(volume, 1.5);
  assert.equal(volume.undoStack[0].bricks, undefined);
  assert.equal(restoreHistory(volume), true); assert.equal(group.scale.x, .8);
  assert.equal(volume.bricks.get('0,0,0').mesh.geometry, geometry);
  assert.equal(restoreHistory(volume, true), true); assert.equal(group.scale.x, .8 * 1.5);
  assert.equal(volume.bricks.get('0,0,0').mesh.geometry, geometry);
  checkpoint(volume); geometry.attributes.position.array[0] = .25;
  assert.equal(restoreHistory(volume), true); assert.equal(volume.userScale, 1.5);
  assert.equal(restoreHistory(volume), true); assert.equal(volume.userScale, 1);
  assert.equal(restoreHistory(volume, true), true); assert.equal(volume.userScale, 1.5);
  assert.equal(restoreHistory(volume, true), true);
  assert.equal(volume.bricks.get('0,0,0').mesh.geometry.attributes.position.array[0], .25);
});

test('Mask size survives layout and viewport changes', () => {
  const item = { group: new THREE.Group(), volume: { userScale: 1.6 } };
  const objects = Object.create(ClayObjects.prototype);
  Object.assign(objects, { items: [item], active: item, updateMarker() {} });
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.z = 8.6;
  objects.layout(camera); assert.equal(item.group.scale.x, item.volume.layoutScale * 1.6);
  camera.aspect = .4; objects.layout(camera);
  assert.equal(item.group.scale.x, item.volume.layoutScale * 1.6); assert.equal(item.volume.userScale, 1.6);
});
