import test from 'node:test';
import assert from 'node:assert/strict';
import { brushApplying, deformationApplying } from '../src/brushAvailability.js';

test('Background work stays green while extrusion can accept another stroke', () => {
  const volume = { meshQueue: { pending: true }, surfaceExtrude: { queue: [], canBegin: true } };
  assert.equal(brushApplying(volume, 'extrude'), false);
  volume.surfaceExtrude.canBegin = false;
  assert.equal(brushApplying(volume, 'extrude'), true);
  volume.surfaceExtrude.active = true; volume.pulling = true;
  assert.equal(brushApplying(volume, 'extrude'), false);
});

test('A full extrusion queue is amber and recovers immediately when it drains', () => {
  const volume = { surfaceExtrude: { queue: [1, 2, 3, 4], canBegin: false } };
  assert.equal(brushApplying(volume, 'extrude'), true);
  volume.surfaceExtrude.queue.pop(); volume.surfaceExtrude.canBegin = true;
  assert.equal(brushApplying(volume, 'extrude'), false);
});

test('Erase feedback distinguishes resumable strokes from incompatible brush settings', () => {
  const options = { radius: .2, eye: [0, 0, 8], planeZ: .9, symmetry: true };
  const volume = { cutting: true, surfaceErase: { active: true, released: true, ...options } };
  assert.equal(brushApplying(volume, 'erase', options), false);
  assert.equal(brushApplying(volume, 'erase', { ...options, radius: .3 }), true);
  assert.equal(brushApplying(volume, 'erase', { ...options, symmetry: false }), true);
  assert.equal(brushApplying(volume, 'erase', { ...options, eye: [0, 0, 9] }), true);
  volume.surfaceErase.released = false;
  assert.equal(brushApplying(volume, 'erase', options), false);
});

test('Pending geometry is amber, optional refinement is green, and errors are not labeled applying', () => {
  assert.equal(brushApplying({ meshQueue: { pending: true } }, 'erase'), true);
  assert.equal(brushApplying({ meshQueue: { refining: true } }, 'erase'), false);
  assert.equal(brushApplying({ meshQueue: { pending: true } }, 'paint'), true);
  assert.equal(brushApplying({ meshFailed: true, meshQueue: { pending: true } }, 'extrude'), false);
});

test('Pull stays ready during a live drag, waits through release and remeshing, then recovers', () => {
  const volume = { pulling: true, surfacePull: { active: true, released: false, busy: false }, meshQueue: { pending: false } };
  assert.equal(brushApplying(volume, 'pinch'), false);
  assert.equal(deformationApplying(volume), false);
  volume.surfacePull.released = true; volume.surfacePull.busy = true;
  assert.equal(brushApplying(volume, 'pinch'), true);
  assert.equal(deformationApplying(volume), true);
  volume.pulling = false; volume.surfacePull.active = false; volume.surfacePull.busy = false;
  volume.meshQueue.pending = true;
  assert.equal(deformationApplying(volume), true);
  volume.meshQueue.pending = false; volume.meshQueue.refining = true;
  assert.equal(brushApplying(volume, 'pinch'), false);
  assert.equal(deformationApplying(volume), false);
});

test('Queued extrusion and erase work remain visible even when another stroke is allowed', () => {
  const extrude = { surfaceExtrude: { committing: true, queue: [], canBegin: true }, meshQueue: { pending: true } };
  assert.equal(brushApplying(extrude, 'extrude'), false);
  assert.equal(deformationApplying(extrude), true);
  const erase = { surfaceErase: { active: true, busy: true, released: false } };
  assert.equal(brushApplying(erase, 'erase'), false);
  assert.equal(deformationApplying(erase), true);
  erase.surfaceErase.active = false; erase.surfaceErase.busy = false;
  assert.equal(deformationApplying(erase), false);
  assert.equal(deformationApplying({ meshFailed: true, meshQueue: { pending: true } }), false);
});
