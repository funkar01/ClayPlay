import test from 'node:test';
import assert from 'node:assert/strict';
import { brushApplying } from '../src/brushAvailability.js';

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
  assert.equal(brushApplying({ meshQueue: { pending: true } }, 'paint'), false);
  assert.equal(brushApplying({ meshFailed: true, meshQueue: { pending: true } }, 'extrude'), false);
});
