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

test('Diagonal cut contours stay close to the stroke without raster stair steps', () => {
  const f = footprint(), result = separateCut(f, [[0.2, -1], [0.8, 1]]);
  assert.equal(result.valid, true);
  assert.equal(result.region.cell, f.cell);
  assert.equal(result.region.distances.length, f.mask.length);
  const offsets = [];
  for (let y = -0.6; y <= 0.6; y += 0.002) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      if (distanceUV(mid, y, result.region) > 0) hi = mid; else lo = mid;
    }
    offsets.push((lo + hi) / 2 - (0.5 + 0.3 * y));
  }
  // Include the fixed fine cut width; smoothing must not move the trim far.
  assert.ok(offsets.every(offset => Math.abs(offset) < f.cell * 1.5));
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const deviation = Math.sqrt(offsets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / offsets.length);
  const roughness = Math.sqrt(offsets.slice(1, -1).reduce((sum, v, i) =>
    sum + (offsets[i] - 2 * v + offsets[i + 2]) ** 2, 0) / (offsets.length - 2));
  assert.ok(deviation < f.cell * 0.1, `Contour deviation: ${deviation}`);
  assert.ok(roughness < f.cell * 0.005, `Contour roughness: ${roughness}`);
});

test('Smoothed loop rims remain round and small cutouts remain open', () => {
  const f = footprint(), result = separateCut(f, loop(0.3, -0.25, 0.2)), radii = [];
  assert.equal(result.valid, true);
  for (let i = 0; i < 360; i++) {
    const angle = i / 360 * 2 * Math.PI;
    let lo = 0, hi = 0.4;
    for (let j = 0; j < 25; j++) {
      const mid = (lo + hi) / 2;
      if (distanceUV(0.3 + Math.cos(angle) * mid, -0.25 + Math.sin(angle) * mid, result.region) > 0) lo = mid; else hi = mid;
    }
    radii.push((lo + hi) / 2);
  }
  assert.ok(Math.max(...radii) - Math.min(...radii) < f.cell * 0.5);
  const roughness = Math.sqrt(radii.reduce((sum, v, i) =>
    sum + (radii[(i + 359) % 360] - 2 * v + radii[(i + 1) % 360]) ** 2, 0) / 360);
  assert.ok(roughness < f.cell * 0.015, `Loop roughness: ${roughness}`);
  const small = separateCut(f, loop(0.3, -0.25, 0.06));
  assert.equal(small.valid, true);
  assert.ok(distanceUV(0.3, -0.25, small.region) > f.cell);
  assert.ok(distanceUV(0.45, -0.25, small.region) < 0);
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
