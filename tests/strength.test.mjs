import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';

const normal = new THREE.Vector3(0, 0, 1);
const start = new THREE.Vector3(-0.05, 0, 1.25);
const end = new THREE.Vector3(0.05, 0, 1.25);

function withVolume(run) {
  const parent = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const volume = new ClayVolume(parent, material);
  try { return run(volume, parent); }
  finally {
    for (const mesh of parent.children) mesh.geometry.dispose();
    material.dispose();
  }
}

function frontSurface(volume, x = 0, y = 0) {
  let outside = 2;
  for (let z = outside - 0.005; z > 0; z -= 0.005) {
    if (volume.sample(x, y, z) <= 0) {
      let inside = z;
      for (let i = 0; i < 16; i += 1) {
        const midpoint = (inside + outside) / 2;
        if (volume.sample(x, y, midpoint) <= 0) inside = midpoint;
        else outside = midpoint;
      }
      return (inside + outside) / 2;
    }
    outside = z;
  }
  throw new Error('Expected a continuous front surface');
}

function assertFiniteMesh(parent) {
  assert.ok(parent.children.length > 0);
  for (const mesh of parent.children) {
    for (const name of ['position', 'normal']) {
      assert.ok(mesh.geometry.attributes[name].array.every(Number.isFinite), `${name} must stay finite`);
    }
  }
}

test('Zero strength leaves the clay untouched for every tool', () => withVolume((volume) => {
  assert.equal(volume.applyPull(start, end, 0.3, 0), false);
  assert.equal(volume.carveStroke(start, end, 0.105, 0, 0.035, normal), false);
  assert.equal(volume.applyBulge(start, end, 0.28, 0, normal), false);
  assert.equal(volume.field.size, 0);
}));

test('Carve strength increases depth while preserving width and rounded stroke ends', () => {
  const depths = [0.025, 0.135, 0.225].map((depth) => withVolume((volume, parent) => {
    assert.equal(volume.carveStroke(start, end, 0.105, depth, 0.035, normal), true);
    // These points lie inside the high-depth edit bounds but outside the cutter.
    for (const point of [[0.24, 0, 1.2], [0, 0.16, 1.2]]) {
      assert.ok(Math.abs(volume.sample(...point) - volume.baseDistance(...point)) < 0.0003,
        'Strength must not widen the groove or extend a flat cut beyond its ends');
    }
    assertFiniteMesh(parent);
    return 1.25 - frontSurface(volume);
  }));
  assert.ok(depths[1] > depths[0] + 0.07);
  assert.ok(depths[2] > depths[1] + 0.05);
  console.log('Carve depths at low/default/high:', depths.map((n) => n.toFixed(3)).join(', '));
});

test('Bulge strength increases height without editing beyond its footprint', () => {
  const heights = [0.015, 0.13875, 0.24].map((amount) => withVolume((volume, parent) => {
    assert.equal(volume.applyBulge(start, end, 0.28, amount, normal), true);
    assert.ok(Math.abs(volume.sample(0, 0.4, 1.2) - volume.baseDistance(0, 0.4, 1.2)) < 0.0003);
    assertFiniteMesh(parent);
    return frontSurface(volume) - 1.25;
  }));
  assert.ok(heights[1] > heights[0] + 0.07);
  assert.ok(heights[2] > heights[1] + 0.05);
  console.log('Bulge heights at low/default/high:', heights.map((n) => n.toFixed(3)).join(', '));
});

test('High-strength pull extends the material farther for the same hand movement', () => {
  const extents = [0.1, 0.55, 1].map((strength) => withVolume((volume, parent) => {
    let point = new THREE.Vector3(1.2, 0, 0.35);
    for (let i = 0; i < 2; i += 1) {
      point = volume.applyPull(point, point.clone().add(new THREE.Vector3(0.1, 0, 0)), 0.3, strength);
      assert.ok(point instanceof THREE.Vector3);
    }
    assertFiniteMesh(parent);
    return new THREE.Box3().setFromObject(parent).max.x;
  }));
  assert.ok(extents[1] > extents[0] + 0.08);
  assert.ok(extents[2] > extents[1] + 0.12);
  console.log('Pull extents at low/default/high:', extents.map((n) => n.toFixed(3)).join(', '));
});
