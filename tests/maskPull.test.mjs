import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeWarp, forwardWarp, inverseWarp, warpNormal } from '../src/maskWarp.js';
import { ClayVolume } from '../src/clayVolume.js';
import { MASK_SHAPES } from '../src/clayShapes.js';
import { checkpoint, restoreHistory } from '../src/sculptHistory.js';
import { PinchGesture } from '../src/pinchGesture.js';

function field(shape) { return ClayVolume.fromState({ shape, cuts: [], field: [] }); }

test('Symmetry mirrors either side; disabled symmetry leaves the other side unchanged', () => {
  for (const side of [-1, 1]) for (const percent of [1, 3, 24]) {
    const center = [side * 0.82, 0.72, 0.3], delta = [side * 0.3, 0.12, 0.04];
    const radius = 1.4 * percent / 100;
    const mirrored = [-center[0], center[1], center[2]];
    const off = makeWarp(center, delta, radius);
    assert.deepEqual(forwardWarp(...mirrored, off), mirrored);
    const on = makeWarp(center, delta, radius, 0.55, true);
    const moved = forwardWarp(...center, on), twin = forwardWarp(...mirrored, on);
    assert.ok(Math.hypot(moved[0] + twin[0], moved[1] - twin[1], moved[2] - twin[2]) < 1e-10);
    assert.ok(Math.hypot(...moved.map((v, i) => v - center[i] - delta[i])) < 1e-8);
    assert.ok(Math.hypot(...inverseWarp(...twin, on).map((v, i) => v - mirrored[i])) < 1e-6);
  }
});

test('Overlapping mirrored brushes preserve the center without doubling or folding', () => {
  const centered = makeWarp([0, 0.7, 0.3], [0.2, 0.15, 0.04], 0.336, 0.55, true);
  assert.equal(centered.delta[0], 0);
  assert.ok(Math.abs(centered.delta[1] - 0.15) < 1e-10);
  const moved = forwardWarp(0, 0.7, 0.3, centered);
  assert.equal(moved[0], 0);
  assert.ok(Math.abs(moved[1] - 0.85) < 1e-10, 'Center pull happens once');
  const warp = makeWarp([0.12, 0.7, 0.3], [-0.4, 0.12, 0.04], 0.336, 1, true);
  assert.equal(warp.delta[0], -0.12, 'Drag stops at the symmetry axis');
  const h = 1e-5;
  for (let x = -0.4; x <= 0.4; x += 0.04) for (let y = 0.4; y <= 1; y += 0.06) {
    const p = [x, y, 0.32], q = forwardWarp(...p, warp), twin = forwardWarp(-x, y, 0.32, warp);
    assert.ok(Math.hypot(q[0] + twin[0], q[1] - twin[1], q[2] - twin[2]) < 1e-8);
    assert.ok(Math.hypot(...inverseWarp(...q, warp).map((v, i) => v - p[i])) < 1e-6);
    assert.ok(x * q[0] >= -1e-10, 'Halves do not cross the center');
    const columns = p.map((_, axis) => {
      const shifted = [...p]; shifted[axis] += h;
      return new THREE.Vector3(...forwardWarp(...shifted, warp)).sub(new THREE.Vector3(...q)).divideScalar(h);
    });
    assert.ok(columns[0].dot(columns[1].clone().cross(columns[2])) > 0);
    const normal = warpNormal(...p, [0, 0, 1], warp), mirrorNormal = warpNormal(-x, y, 0.32, [0, 0, 1], warp);
    assert.ok(Math.hypot(normal[0] + mirrorNormal[0], normal[1] - mirrorNormal[1], normal[2] - mirrorNormal[2]) < 1e-7);
  }
});

test('All starter mask fields remain symmetric through saved mirrored strokes', () => {
  for (const shape of Object.keys(MASK_SHAPES)) {
    const volume = field(shape);
    volume.pullSource = volume.snapshot();
    volume.pullWarp = makeWarp([0.8, 0.6, 0.3], [0.3, 0.15, 0], 0.336, 0.55, true);
    const saved = ClayVolume.fromState(structuredClone(volume.serialize()));
    assert.equal(saved.pullWarp.symmetry, true);
    for (let x = 0; x < 1.4; x += 0.1) for (let y = 0.2; y < 1.1; y += 0.15) {
      assert.ok(Math.abs(saved.sample(x, y, 0.3) - saved.sample(-x, y, 0.3)) < 1e-8);
    }
  }
});

test('Visible pinch survives depth jitter and a brief noisy open frame', () => {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[5].x = 0.45; points[17].x = 0.55; points[4].x = 0.51;
  const gesture = new PinchGesture();
  gesture.update(points, 0, 1.78); gesture.update(points, 33, 1.78);
  assert.equal(gesture.held, true);
  points[4].z = 10; points[8].z = -10;
  gesture.update(points, 66, 1.78); assert.equal(gesture.held, true);
  points[4].x = 0.65; gesture.update(points, 99, 1.78);
  points[4].x = 0.51; gesture.update(points, 132, 1.78); assert.equal(gesture.held, true);
  points[4].x = 0.65;
  for (let now = 165; now <= 330; now += 33) gesture.update(points, now, 1.78);
  assert.equal(gesture.held, false);
});

test('Mask patch follows the hand one-to-one and returns to its original shape', () => {
  const center = [0.82, 0.72, 0.3];
  const warp = makeWarp(center, [0.04, 0.01, 0], 0.336);
  const moved = forwardWarp(...center, warp);
  assert.ok(Math.hypot(...moved.map((v, i) => v - [0.86, 0.73, 0.3][i])) < 1e-10);
  const restored = inverseWarp(...moved, warp);
  assert.ok(Math.hypot(...restored.map((v, i) => v - center[i])) < 1e-6);
  assert.deepEqual(forwardWarp(...center, makeWarp(center, [0, 0, 0], 0.336)), center);
});

test('Fine pinch sizes keep their width while following the entire drag', () => {
  const center = [0.8, 0.7, 0.3];
  for (const percent of [1, 3, 24]) {
    const radius = 1.4 * percent / 100;
    const warp = makeWarp(center, [0.45, 0, 0], radius);
    assert.equal(warp.support, radius);
    assert.ok(Math.abs(warp.delta[0] - 0.45) < 1e-10);
    assert.ok(Math.abs(forwardWarp(...center, warp)[0] - (center[0] + 0.45)) < 1e-8);
    for (const step of warp.steps) assert.ok(Math.hypot(...step.delta) <= radius / 6 + 1e-10);
    const outside = [center[0], center[1] + radius * 1.01, center[2]];
    assert.deepEqual(forwardWarp(...outside, warp), outside);
  }
  const zero = makeWarp(center, [1, 0, 0], 0);
  assert.equal(zero.support, 0);
  assert.deepEqual(forwardWarp(...center, zero), center);
  assert.ok(inverseWarp(...center, zero).every(Number.isFinite));
});

test('Extreme pulls remain invertible with positive local volume across the affected patch', () => {
  const warp = makeWarp([0.8, 0.8, 0.3], [0.3, 0.2, -0.1], 0.3, 1);
  assert.ok(warp.steps.length > 1);
  const h = 1e-4;
  for (let x = -1; x <= 2; x += 0.3) for (let y = -1; y <= 2; y += 0.3) for (let z = -0.5; z <= 0.8; z += 0.3) {
    const original = [x, y, z], moved = forwardWarp(x, y, z, warp);
    const restored = inverseWarp(...moved, warp);
    assert.ok(Math.hypot(...restored.map((v, i) => v - original[i])) < 1e-5);
    const columns = original.map((_, axis) => {
      const p = [...original]; p[axis] += h;
      return new THREE.Vector3(...forwardWarp(...p, warp)).sub(new THREE.Vector3(...moved)).divideScalar(h);
    });
    assert.ok(columns[0].dot(columns[1].clone().cross(columns[2])) > 0, 'No folding or inverted shell');
    assert.ok(warpNormal(x, y, z, [0, 0, 1], warp).every(Number.isFinite));
  }
});

test('All starter masks retain material and eye openings under connected deformation', () => {
  for (const shape of Object.keys(MASK_SHAPES)) {
    const source = field(shape);
    const warp = makeWarp([0.82, 0.65, 0.3], [0.45, 0.1, 0.04], 0.336);
    const volume = field(shape); volume.pullSource = source; volume.pullWarp = warp;
    const inside = [0, 0, 0.68], eye = [0.46, 0.35, 0.5];
    assert.ok(volume.sample(...forwardWarp(...inside, warp)) < 0);
    assert.ok(volume.sample(...forwardWarp(...eye, warp)) > 0);
    const roundtrip = ClayVolume.fromState(structuredClone(volume.serialize()));
    assert.ok(Math.abs(roundtrip.sample(0.5, 0.3, 0.5) - volume.sample(0.5, 0.3, 0.5)) < 1e-10);
  }
});

test('Repeated pulls preserve earlier voxel edits and serialize without losing the surface', () => {
  let volume = field('full');
  volume.field.set(volume.nodeKey(96, 96, 122), -0.2);
  for (let i = 0; i < 12; i++) {
    const next = field('full');
    next.pullSource = volume.snapshot();
    next.pullWarp = makeWarp([0.7, 0.7, 0.3], [0.04, 0.01, 0], 0.336);
    volume = next;
  }
  const restored = ClayVolume.fromState(structuredClone(volume.serialize()));
  assert.equal(restored.sample(0, 0, 0.65), volume.sample(0, 0, 0.65));
  let original = restored; while (original.pullSource) original = original.pullSource;
  assert.equal(original.field.size, 1);
});

test('Undo and redo restore exact geometry and authoritative mask field', () => {
  globalThis.document = { dispatchEvent() {} };
  const volume = field('full');
  Object.assign(volume, { parent: new THREE.Group(), material: new THREE.MeshBasicMaterial(), bricks: new Map(), cutRevision: 0 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.68, 0.1, 0, 0.65, 0, 0.1, 0.65], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const mesh = new THREE.Mesh(geometry, volume.material);
  volume.parent.add(mesh); volume.bricks.set('0,0,0', { mesh });
  const initial = [...geometry.attributes.position.array];
  checkpoint(volume);
  volume.pullSource = volume.snapshot(); volume.pullWarp = makeWarp([0, 0, 0.68], [0.3, 0, 0], 0.336);
  geometry.attributes.position.array[0] = 0.3;
  const changed = [...geometry.attributes.position.array];
  const sample = volume.sample(0.3, 0, 0.68);
  assert.ok(restoreHistory(volume));
  assert.deepEqual([...volume.bricks.get('0,0,0').mesh.geometry.attributes.position.array], initial);
  assert.equal(volume.pullSource, null);
  assert.ok(restoreHistory(volume, true));
  assert.deepEqual([...volume.bricks.get('0,0,0').mesh.geometry.attributes.position.array], changed);
  assert.equal(volume.sample(0.3, 0, 0.68), sample);
  delete globalThis.document;
});
