import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { eraseDistance, eraseBrickBounds, eraseNodes } from '../src/eraseGeometry.js';
import { SurfaceErase } from '../src/surfaceErase.js';
import { checkpoint, restoreHistory } from '../src/sculptHistory.js';
import { makeWarp } from '../src/maskWarp.js';

const eye = [0, 0, 8.6], planeZ = .9;
const field = () => ClayVolume.fromState({ shape: 'full', field: [] });
const bounds = eraseBrickBounds([{ positions: new Float32Array([-1.05,-1.4,.05, 1.05,1.4,.8]) }], eye, planeZ);

test('Erase sweeps a continuous circular brush without needing a closed outline', () => {
  const points = [[-.4, -.6], [.4, -.6]];
  for (const x of [-.4, 0, .4]) assert.ok(eraseDistance(x,-.6,.9,points,.12,eye,planeZ) > .11);
  assert.ok(eraseDistance(0,-.8,.9,points,.12,eye,planeZ) < 0);
  assert.ok(eraseDistance(0,-.6,.9,[[0,-.6]],.12,eye,planeZ) > 0);
  // The same camera ray erases the front and back shell surfaces.
  for (const z of [.2,.5,.7]) {
    const y = -.6 * (z - eye[2]) / (planeZ - eye[2]);
    assert.ok(eraseDistance(0,y,z,[[0,-.6]],.12,eye,planeZ) > .11);
  }
});

test('Erase symmetry reflects the removed material even with an off-center camera', () => {
  const camera = [-.8,.1,8.6], path = [[.65,-.5]], point = [.65,-.5,.9];
  assert.ok(eraseDistance(...point,path,.15,camera,planeZ,false) > 0);
  assert.ok(eraseDistance(-point[0],point[1],point[2],path,.15,camera,planeZ,false) < 0);
  for (const x of [.3,.6,.8]) for (const z of [.25,.6]) {
    assert.equal(eraseDistance(x,-.5,z,path,.15,camera,planeZ,true), eraseDistance(-x,-.5,z,path,.15,camera,planeZ,true));
  }
});

test('Erasing removes only the brush footprint and survives serialization, pull, and history', () => {
  const v = field();
  Object.assign(v, { parent: new THREE.Group(), material: new THREE.MeshBasicMaterial(), bricks: new Map() });
  const oldDocument = globalThis.document; globalThis.document = { dispatchEvent() {} };
  try {
    const original = v.serialize(), outside = v.sample(.75,-.85,.325);
    assert.ok(v.sample(0,-.6,.475) < 0); checkpoint(v);
    const result = eraseNodes(v,bounds,[[0,-.6]],.2,eye,planeZ,false);
    assert.ok(result.edits.length > 0); assert.ok(result.keys.length < bounds.length);
    assert.ok(v.sample(0,-.6,.475) > 0); assert.equal(v.sample(.75,-.85,.325),outside);
    const saved = structuredClone(v.serialize()), copy = ClayVolume.fromState(saved);
    assert.equal(copy.sample(0,-.6,.475),v.sample(0,-.6,.475));
    const pulled = field(); pulled.pullSource = copy; pulled.pullWarp = makeWarp([.6,.8,.35],[.2,0,0],.15);
    assert.ok(pulled.sample(0,-.6,.475) > 0,'Pulling another patch preserves the erased hole');
    assert.ok(restoreHistory(v)); assert.deepEqual(v.serialize(),original);
    assert.ok(restoreHistory(v,true)); assert.deepEqual(v.serialize(),saved);
  } finally { globalThis.document = oldDocument; v.material.dispose(); }
});

test('A zero brush, an empty stroke, or distant empty space leaves the field unchanged', () => {
  const v = field();
  for (const [points,radius] of [[[[0,-.6]],0],[[],.2],[[[10,10]],.2]]) {
    assert.equal(eraseNodes(v,bounds,points,radius,eye,planeZ,false).edits.length,0);
    assert.equal(v.field.size,0);
  }
});

function fixture(t) {
  const oldWorker = globalThis.Worker, oldDocument = globalThis.document;
  globalThis.document = { dispatchEvent() {} };
  globalThis.Worker = class {
    messages = [];
    postMessage(data) { this.messages.push(data); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  };
  const v = field(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,.5,.1,0,.5,0,.1,.5],3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  Object.assign(v,{ parent: new THREE.Group(), material: new THREE.MeshBasicMaterial(), bricks: new Map() });
  const mesh = new THREE.Mesh(geometry,v.material); v.parent.add(mesh); v.bricks.set('4,4,4',{mesh});
  const events = [], erase = new SurfaceErase(v,event=>events.push(event));
  assert.equal(erase.begin(.2,eye,planeZ,false),true);
  const worker = erase.worker;
  t.after(()=>{erase.abort(); v.material.dispose(); geometry.dispose(); globalThis.Worker=oldWorker; globalThis.document=oldDocument;});
  return {v,erase,worker,events};
}

test('Release freezes erase input, finishes only held samples, and records one Undo entry', t => {
  const {v,erase,worker} = fixture(t);
  erase.update([0,-.6]); erase.update([.1,-.6]); erase.finish();
  erase.update([99,99]);
  worker.reply({edits:[[1,.2]],bricks:[],duration:1});
  assert.deepEqual(worker.messages.at(-1).points,[[.1,-.6]]);
  worker.reply({edits:[[2,.2]],bricks:[],duration:1});
  assert.equal(v.undoStack.length,1); assert.equal(v.erasing,false); assert.equal(v.cutting,false);
  assert.equal(worker.terminated,true); assert.equal(v.field.size,2);
  assert.ok(worker.messages.every(m=>!(m.points??[]).some(p=>p[0]===99)));
});

test('No-op erasure creates no history and worker failures release input ownership', t => {
  const {v,erase,worker} = fixture(t);
  erase.update([10,10]); erase.finish(); worker.reply({edits:[],bricks:[],duration:1});
  assert.equal(v.undoStack?.length??0,0); assert.equal(v.cutting,false);
  assert.equal(erase.begin(.2,eye,planeZ,true),true);
  erase.worker.reply({error:'Simulated failure'});
  assert.equal(v.erasing,false); assert.equal(v.cutting,false); assert.equal(erase.active,false);
});
