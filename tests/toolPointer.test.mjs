import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pointerOnPlane } from '../src/toolPointer.js';

test('Tool aim projects back to the exact cursor across canvas sizes, offsets and surface depths', () => {
  for (const bounds of [
    { left: 80, top: 130, width: 1280, height: 720 },
    { left: 12, top: 45, width: 390, height: 700 },
  ]) {
    const camera = new THREE.PerspectiveCamera(45, bounds.width / bounds.height, .1, 100);
    camera.position.z = 8.6; camera.updateMatrixWorld();
    for (const planeZ of [0, .9, 2]) for (const [u, v] of [[.1,.2],[.5,.5],[.85,.75]]) {
      const point = { x: bounds.left + u * bounds.width, y: bounds.top + v * bounds.height };
      const aim = pointerOnPlane(point, bounds, camera, planeZ);
      assert.ok(Math.abs(aim.z - planeZ) < 1e-9);
      const projected = aim.project(camera);
      assert.ok(Math.abs(bounds.left + (projected.x + 1) / 2 * bounds.width - point.x) < 1e-8);
      assert.ok(Math.abs(bounds.top + (1 - projected.y) / 2 * bounds.height - point.y) < 1e-8);
    }
  }
});

test('Missing cursor or collapsed canvas cannot produce a tool position', () => {
  const camera = new THREE.PerspectiveCamera();
  assert.equal(pointerOnPlane(null, { width: 100, height: 100 }, camera), null);
  assert.equal(pointerOnPlane({ x: 10, y: 10 }, { width: 0, height: 100 }, camera), null);
});
