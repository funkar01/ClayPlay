import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { closedPalm, PalmMove, PalmGesture } from '../src/palmMove.js';
import { PinchGesture } from '../src/pinchGesture.js';
import { checkpoint, checkpointPosition, checkpointScale, applyMaskPosition, applyMaskScale, restoreHistory } from '../src/sculptHistory.js';
import { ClayObjects } from '../src/clayObjects.js';
import { ClayVolume } from '../src/clayVolume.js';

function hand(closed = true) {
  const p = Array.from({ length: 21 }, () => ({ x: .5, y: .5, z: 0 }));
  p[0].y = .65;
  for (const [joint, tip, dx] of [[6,8,-.035], [10,12,0], [14,16,.03], [18,20,.055]]) {
    p[joint] = { x: .5 + dx, y: .42, z: 0 };
    p[tip] = { x: .5 + dx, y: closed ? .55 : .3, z: 0 };
  }
  return p;
}

test('Whole-hand closure wins over touching thumb/index tips and tolerates one noisy outer finger', () => {
  for (const aspect of [1, 1.78]) {
    assert.equal(closedPalm(hand(), aspect), true);
    assert.equal(closedPalm(hand(false), aspect), false);
    const partlyOpen = hand(); partlyOpen[8].y = .3;
    assert.equal(closedPalm(partlyOpen, aspect), false);
    const fist = hand(); fist[4] = { ...fist[8] };
    assert.equal(closedPalm(fist, aspect), true);
    fist[20].y = .3;
    assert.equal(closedPalm(fist, aspect), true);
    const pinch = hand(false); pinch[4] = { ...pinch[8] };
    assert.equal(closedPalm(pinch, aspect), false);
  }
  assert.equal(closedPalm([]), false);
  const invalid = hand(); invalid[20].x = NaN;
  assert.equal(closedPalm(invalid), false);
});

test('Closing outer fingers reserves movement before the index curls, even with touching tips', () => {
  const gesture = new PalmGesture(), pinch = new PinchGesture(), closing = hand(false);
  closing[12].y = closing[16].y = .55; closing[4] = { ...closing[8] };
  for (const now of [0,33,66,100]) {
    const intent = gesture.update(closing, now, 1.78);
    assert.equal(intent.blocksPinch, true); assert.equal(intent.held, false);
    if (intent.blocksPinch) pinch.reset(); else pinch.update(closing, now, 1.78);
    assert.equal(pinch.held, false);
  }
  const fist = hand(); fist[4] = { ...fist[8] };
  assert.equal(gesture.update(fist, 133, 1.78).held, true);
});

test('Movement stays reserved through noisy finger poses and cannot become a pinch during partial opening', () => {
  const gesture = new PalmGesture(), fist = hand(); fist[4] = { ...fist[8] };
  assert.equal(gesture.update(fist, 0).held, true);
  const uncertain = hand(); uncertain[8].y = .41; uncertain[4] = { ...uncertain[8] };
  assert.equal(closedPalm(uncertain), false);
  assert.equal(gesture.update(uncertain, 33).held, true);
  assert.equal(gesture.update(fist, 66).blocksPinch, true);
  const partlyOpen = hand(); partlyOpen[8].y = .3; partlyOpen[4] = { ...partlyOpen[8] };
  for (const now of [100,133,166,200]) {
    const intent = gesture.update(partlyOpen, now);
    assert.equal(intent.held, false); assert.equal(intent.blocksPinch, true);
  }
  const pinch = hand(false); pinch[4] = { ...pinch[8] };
  assert.equal(gesture.update(pinch, 233).blocksPinch, true, 'Opening fingers while tips still touch cannot start sculpting');
});

test('Opening stops movement immediately and must stay clear briefly before sculpting can resume', () => {
  const gesture = new PalmGesture(), fist = hand(), open = hand(false);
  gesture.update(fist, 0);
  const firstOpen = gesture.update(open, 33);
  assert.equal(firstOpen.held, false); assert.equal(firstOpen.blocksPinch, true);
  assert.equal(gesture.update(fist, 66).held, true, 'A single incorrect open frame cannot change tools');
  gesture.update(open, 100);
  assert.equal(gesture.update(open, 133).blocksPinch, true);
  assert.equal(gesture.update(open, 166).released, true);
  const pinch = hand(false); pinch[4] = { ...pinch[8] };
  const sculpt = new PinchGesture();
  for (const now of [200,233]) {
    assert.equal(gesture.update(pinch, now).blocksPinch, false);
    sculpt.update(pinch, now);
  }
  assert.equal(sculpt.held, true, 'Ordinary pinch keeps its original short confirmation');
});

test('Lost or malformed tracking never unlocks a palm gesture into an accidental pinch', () => {
  assert.equal(new PalmGesture().update([], 0).blocksPinch, true, 'An unreadable posture cannot safely start a pinch');
  const gesture = new PalmGesture(); gesture.update(hand(), 0);
  for (const pose of [null,[],hand().map(p => ({ ...p, x: NaN }))]) {
    const intent = gesture.update(pose, 33); assert.equal(intent.held, false); assert.equal(intent.blocksPinch, true);
  }
  const pinch = hand(false); pinch[4] = { ...pinch[8] };
  assert.equal(gesture.update(pinch, 66).blocksPinch, true);
  gesture.reset(true);
  assert.equal(gesture.update(pinch, 100).blocksPinch, true);
  gesture.update(hand(false), 133); gesture.update(hand(false), 200);
  assert.equal(gesture.update(pinch, 233).blocksPinch, false);
});

test('A natural pinch still works with a relaxed curled pinky or ring finger', () => {
  for (const curledTip of [16,20]) {
    const pinch = hand(false); pinch[4] = { ...pinch[8] }; pinch[curledTip].y = .55;
    const gesture = new PalmGesture(), sculpt = new PinchGesture();
    for (const now of [0,33,66]) {
      assert.equal(gesture.update(pinch, now, 1.78).blocksPinch, false);
      sculpt.update(pinch, now, 1.78);
    }
    assert.equal(sculpt.held, true);
  }
});

test('Palm and pinch intent remain distinct for either hand, rotated palms, and camera aspect changes', () => {
  for (const aspect of [1,1.78]) for (const sign of [-1,1]) for (const angle of [-.6,0,.7]) {
    const rotate = points => points.map(p => {
      const x = (p.x - .5) * aspect * sign, y = p.y - .5;
      return { x: .5 + (x * Math.cos(angle) - y * Math.sin(angle)) / aspect,
        y: .5 + x * Math.sin(angle) + y * Math.cos(angle), z: p.z };
    });
    const fist = hand(); fist[4] = { ...fist[8] };
    const pinch = hand(false); pinch[4] = { ...pinch[8] };
    assert.equal(new PalmGesture().update(rotate(fist), 0, aspect).held, true);
    assert.equal(new PalmGesture().update(rotate(pinch), 0, aspect).blocksPinch, false);
  }
});

test('A palm must settle on the surface before picking up the mask, without snapping to the cursor', () => {
  const move = new PalmMove(), offset = [.3, -.2], point = { x: .7, y: -.4 };
  assert.equal(move.update(point, true, 0, offset, false).phase, 'waiting');
  assert.equal(move.update(point, true, 10, offset, true).phase, 'ready');
  assert.equal(move.update(point, true, 80, offset, false).phase, 'waiting');
  assert.equal(move.update(point, true, 90, offset, true).phase, 'ready');
  assert.equal(move.update(point, true, 190, offset, true).started, true);
  assert.deepEqual(move.update(point, true, 200, offset).offset, offset);
  const result = move.update({ x: 1.1, y: .1 }, true, 220, offset);
  assert.ok(Math.abs(result.offset[0] - .7) < 1e-12 && Math.abs(result.offset[1] - .3) < 1e-12);
  assert.equal(move.active, true);
});

test('Opening, missing points, and invalid tracking freeze the displayed position immediately', () => {
  for (const [point, held] of [[{ x: 9, y: 9 }, false], [null, true], [{ x: NaN, y: 0 }, true]]) {
    const move = new PalmMove(), displayed = [.25, .1];
    move.update({ x: 0, y: 0 }, true, 0, [0,0], true);
    move.update({ x: 0, y: 0 }, true, 100, [0,0], true);
    move.update({ x: 1, y: 1 }, true, 130, displayed);
    const end = move.update(point, held, 140, displayed);
    assert.equal(end.finished, true); assert.equal(move.active, false);
    assert.deepEqual(end.offset, displayed);
    move.update({ x: 2, y: 2 }, true, 200, displayed, true);
    const fresh = move.update({ x: 2, y: 2 }, true, 300, displayed, true);
    assert.equal(fresh.started, true); assert.deepEqual(fresh.offset, displayed);
  }
});

test('Movement keeps the mask centre inside view and cancelled grabs require an open palm', () => {
  const move = new PalmMove(), bounds = { min: [-2,-1], max: [2,1] };
  move.update({ x: 0, y: 0 }, true, 0, [0,0], true);
  move.update({ x: 0, y: 0 }, true, 100, [0,0], true);
  assert.deepEqual(move.update({ x: 10, y: -10 }, true, 150, [0,0], false, bounds).offset, [2,-1]);
  move.reset(true);
  assert.equal(move.update({ x: 0, y: 0 }, true, 200, [2,-1], true).phase, 'waiting');
  move.update({ x: 0, y: 0 }, false, 220, [2,-1]);
  assert.equal(move.update({ x: 0, y: 0 }, true, 250, [2,-1], true).phase, 'ready');
});

test('Position and reset undo share geometry and preserve size through mixed sculpt history', t => {
  globalThis.document = { dispatchEvent() {} }; t.after(() => { delete globalThis.document; });
  const parent = new THREE.Group(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, .1,0,0, 0,.1,0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); parent.add(mesh);
  const volume = ClayVolume.fromState({ shape: 'full', field: [] });
  Object.assign(volume, { parent, material: mesh.material, bricks: new Map([['0,0,0',{mesh}]]), layoutPosition: [.4,-.08,.2] });
  applyMaskScale(volume, 1.5); applyMaskPosition(volume, [0,0]);
  checkpointPosition(volume); applyMaskPosition(volume, [.6,.4]);
  assert.equal(volume.undoStack[0].bricks, undefined);
  assert.deepEqual(parent.position.toArray(), [1,.32,.2]);
  assert.equal(restoreHistory(volume), true); assert.deepEqual(volume.userOffset, [0,0]);
  assert.equal(restoreHistory(volume, true), true); assert.deepEqual(volume.userOffset, [.6,.4]);
  checkpointPosition(volume); applyMaskPosition(volume, [0,0]);
  assert.equal(volume.userScale, 1.5);
  assert.equal(restoreHistory(volume), true); assert.deepEqual(volume.userOffset, [.6,.4]);
  assert.equal(volume.bricks.get('0,0,0').mesh.geometry, geometry);
  checkpointScale(volume); applyMaskScale(volume, 2);
  restoreHistory(volume); assert.deepEqual(volume.userOffset, [.6,.4]);
  checkpoint(volume); geometry.attributes.position.array[0] = .25;
  restoreHistory(volume); assert.equal(volume.userScale, 1.5); assert.deepEqual(volume.userOffset, [.6,.4]);
  restoreHistory(volume); assert.deepEqual(volume.userOffset, [0,0]);
  restoreHistory(volume, true); assert.deepEqual(volume.userOffset, [.6,.4]);
});

test('Layout and viewport changes preserve each mask position offset and size', () => {
  const items = [[.6,.3], [-.4,-.2]].map(userOffset => ({ group: new THREE.Group(), volume: { userOffset, userScale: 1.4 } }));
  const objects = Object.create(ClayObjects.prototype);
  Object.assign(objects, { items, active: items[0], updateMarker() {} });
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.z = 8.6;
  for (const aspect of [1,.4,1.8]) {
    camera.aspect = aspect; objects.layout(camera);
    for (const { group, volume } of items) {
      assert.deepEqual(group.position.toArray(), [volume.layoutPosition[0] + volume.userOffset[0], volume.layoutPosition[1] + volume.userOffset[1], 0]);
      assert.equal(group.scale.x, volume.layoutScale * 1.4);
    }
  }
});
