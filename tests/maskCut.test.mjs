import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { projectCutPoint, rasterizeMask, prepareCutPath, separateCut, cutDistance } from '../src/cutGeometry.js';
import { ClayVolume } from '../src/clayVolume.js';
import { makeWarp } from '../src/maskWarp.js';
import { checkpoint, restoreHistory } from '../src/sculptHistory.js';

function footprint() {
  const width = 120, height = 100, cell = 0.02, min = [-1.2, -1];
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (Math.abs(min[0] + (x + 0.5) * cell) < 1 && Math.abs(min[1] + (y + 0.5) * cell) < 0.8) mask[x + y * width] = 1;
  }
  return { mask, width, height, min, cell, eye: [0, 0, 8.6], planeZ: 0.9 };
}
const loop = (x, y, r) => Array.from({ length: 33 }, (_, i) => [x + r * Math.cos(i / 32 * 2 * Math.PI), y + r * Math.sin(i / 32 * 2 * Math.PI)]);
function distanceUV(u, v, region) { return cutDistance(u, v, region.planeZ, region); }

test('Curved edge-to-edge cut removes the smaller area independent of stroke direction', () => {
  const path = [[0.6, -1], [0.55, -0.3], [0.7, 0.3], [0.6, 1]];
  const a = separateCut(footprint(), path), b = separateCut(footprint(), [...path].reverse());
  assert.equal(a.valid, true); assert.equal(a.closed, false);
  assert.ok(a.removedArea > 0.4 && a.removedArea < 0.9);
  assert.ok(distanceUV(0.9, 0, a.region) > 0);
  assert.ok(distanceUV(0, 0, a.region) < 0);
  assert.deepEqual(a.region.distances, b.region.distances);
});

test('A nearly closed loop snaps shut and removes only the smaller enclosed patch', () => {
  const path = loop(0.3, -0.25, 0.2).slice(0, -1);
  assert.equal(prepareCutPath(path).closed, true);
  const a = separateCut(footprint(), path), b = separateCut(footprint(), [...path].reverse());
  assert.equal(a.valid, true); assert.equal(a.closed, true);
  assert.ok(distanceUV(0.3, -0.25, a.region) > 0.1);
  assert.ok(distanceUV(-0.3, -0.25, a.region) < 0);
  assert.deepEqual(a.region.distances, b.region.distances);
});

test('An incomplete cut, an empty stroke, and a click never change the footprint', () => {
  const f = footprint(), original = f.mask.slice();
  for (const path of [[], [[0, 0]], [[0, 0], [0.1, 0]], [[0.6, -0.5], [0.6, 0.5]], [[2, -1], [2, 1]]]) {
    assert.equal(separateCut(f, path).valid, false);
    assert.deepEqual(f.mask, original);
  }
});

test('Edge cuts tolerate endpoints just inside the silhouette', () => {
  const result = separateCut(footprint(), [[0.6, -0.76], [0.6, 0.76]]);
  assert.equal(result.valid, true);
  assert.ok(distanceUV(0.9, 0, result.region) > 0);
  assert.ok(distanceUV(0, 0, result.region) < 0);
});

test('Symmetry cuts both sides and keeps the larger center piece', () => {
  const result = separateCut(footprint(), [[0.7, -1], [0.7, 1]], true);
  assert.equal(result.valid, true);
  assert.ok(distanceUV(0, 0, result.region) < 0);
  for (const x of [-0.9, 0.9]) assert.ok(distanceUV(x, 0, result.region) > 0);
  for (let x = 0; x < 1.1; x += 0.05) assert.ok(Math.abs(distanceUV(x, 0, result.region) - distanceUV(-x, 0, result.region)) < 1e-6);
});

test('Perspective footprint projects both shell surfaces onto the cursor plane', () => {
  const eye = [1, 0.5, 8.6], planeZ = 0.9;
  const p = projectCutPoint(0.8, 0.2, 0.4, eye, planeZ);
  assert.ok(p.every(Number.isFinite));
  const bricks = [{ positions: new Float32Array([-1, -1, 0.4, 1, -1, 0.4, 1, 1, 0.4, -1, -1, 0.4, 1, 1, 0.4, -1, 1, 0.4]) }];
  const raster = rasterizeMask(bricks, eye, planeZ);
  assert.ok(raster.mask.reduce((a, b) => a + b, 0) > 8000);
  assert.equal(separateCut(raster, [[0.6, -1.3], [0.6, 1.3]]).valid, true);
});

test('Cut fields survive subsequent pulls, serialization, and exact undo/redo', () => {
  globalThis.document = { dispatchEvent() {} };
  const volume = ClayVolume.fromState({ shape: 'full', field: [] });
  Object.assign(volume, { parent: new THREE.Group(), material: new THREE.MeshBasicMaterial(), bricks: new Map() });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.68, 0.1, 0, 0.65, 0, 0.1, 0.65], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const mesh = new THREE.Mesh(geometry, volume.material); volume.parent.add(mesh); volume.bricks.set('0,0,0', { mesh });
  const original = [...geometry.attributes.position.array];
  const result = separateCut(footprint(), [[0.6, -1], [0.6, 1]]);
  checkpoint(volume);
  volume.cutSource = volume.snapshot(); volume.cutRegion = result.region;
  geometry.attributes.position.array[0] = -0.2;
  const changed = [...geometry.attributes.position.array];
  assert.ok(volume.sample(0.8, 0, 0.35) > 0);
  assert.ok(volume.sample(0, 0, 0.68) < 0);
  const pulled = ClayVolume.fromState({ shape: 'full', field: [] });
  pulled.pullSource = volume.snapshot(); pulled.pullWarp = makeWarp([-0.8, 0.7, 0.3], [-0.1, 0.1, 0], 0.336);
  const restored = ClayVolume.fromState(structuredClone(pulled.serialize()));
  assert.ok(restored.sample(0.8, 0, 0.35) > 0);
  assert.equal(restored.sample(-0.8, 0.7, 0.3), pulled.sample(-0.8, 0.7, 0.3));
  assert.ok(restoreHistory(volume)); assert.equal(volume.cutSource, null);
  assert.deepEqual([...volume.bricks.get('0,0,0').mesh.geometry.attributes.position.array], original);
  assert.ok(restoreHistory(volume, true)); assert.ok(volume.cutSource);
  assert.deepEqual([...volume.bricks.get('0,0,0').mesh.geometry.attributes.position.array], changed);
  delete globalThis.document;
});
