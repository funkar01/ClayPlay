import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SurfacePull } from '../src/surfacePull.js';

function fixture(t) {
  const previousWorker = globalThis.Worker, previousDocument = globalThis.document;
  globalThis.document = { dispatchEvent() {} };
  globalThis.Worker = class {
    messages = [];
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, .1,0,0, 0,.1,0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
  const material = new THREE.MeshBasicMaterial(), parent = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material); parent.add(mesh);
  const volume = { bricks: new Map([['0,0,0', { mesh }]]), parent, material,
    snapshot: () => ({ original: true }), undoStack: [{}], field: new Map() };
  let changes = 0;
  const pull = new SurfacePull(volume, () => changes++);
  assert.equal(pull.begin(new THREE.Vector3(), .336, .55), true);
  const worker = pull.worker;
  t.after(() => { pull.abort(); geometry.dispose(); material.dispose();
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  const response = (warp, final = false) => ({ warp, final, duration: 1, bricks: [{ key: '0,0,0',
    positions: new Float32Array([warp.delta[0],0,0, .1,0,0, 0,.1,0]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1]) }] });
  return { pull, worker, volume, geometry, response, changes: () => changes };
}

test('Release freezes the visible patch and discards in-flight and queued movement', t => {
  const f = fixture(t);
  f.pull.update(new THREE.Vector3(.1, 0, 0));
  const visible = f.worker.messages.at(-1).warp;
  f.worker.reply(f.response(visible));
  const frozen = [...f.geometry.attributes.position.array];
  f.pull.update(new THREE.Vector3(.2, 0, 0));
  const late = f.worker.messages.at(-1).warp;
  f.pull.update(new THREE.Vector3(.3, 0, 0));
  f.pull.finish();
  assert.equal(f.pull.update(new THREE.Vector3(1, 0, 0)), null);
  f.worker.reply(f.response(late));
  assert.deepEqual([...f.geometry.attributes.position.array], frozen);
  const final = f.worker.messages.at(-1);
  assert.equal(final.final, true); assert.deepEqual(final.warp, visible);
  f.worker.reply(f.response(final.warp, true));
  assert.deepEqual([...f.geometry.attributes.position.array], frozen);
  assert.deepEqual(f.volume.pullWarp, visible);
  assert.equal(f.volume.pulling, false); assert.equal(f.changes(), 1);
  assert.equal(f.worker.terminated, true);
});

test('Release before the first preview prevents a late deformation and removes empty history', t => {
  const f = fixture(t), original = [...f.geometry.attributes.position.array];
  f.pull.update(new THREE.Vector3(.3, 0, 0));
  const late = f.worker.messages.at(-1).warp;
  f.pull.finish(); f.pull.finish();
  f.worker.reply(f.response(late));
  assert.deepEqual([...f.geometry.attributes.position.array], original);
  const final = f.worker.messages.at(-1);
  assert.deepEqual(final.warp.delta, [0,0,0]);
  f.worker.reply(f.response(final.warp, true));
  assert.deepEqual([...f.geometry.attributes.position.array], original);
  assert.equal(f.volume.undoStack.length, 0); assert.equal(f.changes(), 0);
  assert.equal(f.volume.pulling, false);
});
