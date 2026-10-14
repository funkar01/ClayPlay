import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EYE_SHAPES, MASK_SHAPES, eyeDistance, faceSurface } from '../src/clayShapes.js';
import { ClayVolume } from '../src/clayVolume.js';
import { checkpoint, restoreHistory } from '../src/sculptHistory.js';
import { makeWarp, forwardWarp } from '../src/maskWarp.js';

test('All eye styles cut mirrored openings through every base and keep the nose bridge', () => {
  for (const eyes of Object.keys(EYE_SHAPES)) for (const shape of Object.values(MASK_SHAPES)) {
    for (const x of [-.46,.46]) for (const dz of [-.1,0,.1]) {
      assert.ok(shape.distance(x,.35,faceSurface(x,.35)+dz,eyes) > 0, eyes);
    }
    assert.ok(eyeDistance(0,.35,eyes) > .1, `${eyes} bridge clearance`);
    for (let x = .1; x < .9; x += .08) for (let y = .1; y < .65; y += .08) {
      assert.ok(Math.abs(eyeDistance(x,y,eyes)-eyeDistance(-x,y,eyes)) < 1e-12);
    }
  }
});

test('Eye styles produce distinct opening silhouettes', () => {
  const signatures = Object.keys(EYE_SHAPES).map(eyes => {
    let result = '';
    for (let x = .15; x < .8; x += .025) for (let y = .1; y < .65; y += .025) result += eyeDistance(x,y,eyes) < 0 ? '1' : '0';
    return result;
  });
  assert.equal(new Set(signatures).size, Object.keys(EYE_SHAPES).length);
});

test('Changing eyes keeps sculpt sources and edits without mutating previous history', () => {
  const volume = ClayVolume.fromState({shape:'full', eyeShape:'oval', field:[[123,-.2]]});
  volume.pullSource = ClayVolume.fromState({shape:'full', eyeShape:'oval', field:[[456,-.1]]});
  volume.pullWarp = makeWarp([.8,.7,.3],[.1,0,0],.3);
  const previous = volume.snapshot();
  let rebuilt = 0, reset = 0;
  volume.rebuildSurface = () => rebuilt++;
  volume.meshQueue = {reset:() => reset++};
  volume.setEyeShape('slanted');
  assert.equal(volume.eyeShape,'slanted');
  assert.equal(volume.pullSource.eyeShape,'slanted');
  assert.equal(previous.eyeShape,'oval');
  assert.equal(previous.pullSource.eyeShape,'oval');
  assert.equal(volume.field.get(123),-.2);
  assert.equal(volume.pullSource.field.get(456),-.1);
  assert.equal(rebuilt,1); assert.equal(reset,1);
  assert.throws(() => volume.setEyeShape('unknown'));
});

test('Eye choice survives snapshot, worker serialization, deformation and undo/redo', () => {
  globalThis.document ??= new EventTarget();
  for (const eyes of Object.keys(EYE_SHAPES)) {
    const volume = ClayVolume.fromState({ shape:'full', eyeShape:eyes, field:[] });
    Object.assign(volume, { parent:new THREE.Group(), bricks:new Map(), material:null });
    checkpoint(volume);
    volume.eyeShape = 'round';
    assert.equal(restoreHistory(volume),true);
    assert.equal(volume.eyeShape,eyes);
    assert.equal(restoreHistory(volume,true),true);
    assert.equal(volume.eyeShape,'round');
    volume.eyeShape = eyes;
    const source = volume.snapshot();
    volume.pullSource = source;
    volume.pullWarp = makeWarp([.46,.35,.5],[.1,0,.04],.3);
    const restored = ClayVolume.fromState(structuredClone(volume.serialize()));
    assert.equal(restored.eyeShape,eyes);
    assert.equal(restored.pullSource.eyeShape,eyes);
    const eye = [.46,.35,faceSurface(.46,.35)];
    assert.ok(restored.sample(...forwardWarp(...eye,volume.pullWarp)) > 0);
  }
});
