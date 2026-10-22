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

test('A second erase starts immediately while the first saves, with separate paths and Undo entries', t => {
  const {v,erase,worker}=fixture(t),preview=[];
  v.erasePreview={last:null,update:p=>preview.push([...p]),clear(){}};
  erase.update([0,-.6]);erase.update([.1,-.6]);erase.finish();
  assert.equal(erase.begin(.2,eye,planeZ,false),true);
  erase.update([.7,.6]);erase.finish();
  assert.deepEqual(preview,[[0,-.6],[.1,-.6],[.7,.6]]);
  worker.reply({edits:[[1,.2]],bricks:[],duration:1});
  assert.equal(worker.messages.at(-1).breakBefore,false);
  worker.reply({edits:[[2,.2]],bricks:[],duration:1});
  assert.deepEqual(worker.messages.at(-1).points,[[.7,.6]]);
  assert.equal(worker.messages.at(-1).breakBefore,true,'never erase across the gap between strokes');
  worker.reply({edits:[[3,.2]],bricks:[],duration:1});
  assert.equal(v.undoStack.length,2);
  assert.deepEqual([...v.undoStack[1].state.field.keys()],[1,2]);
  assert.equal(erase.active,false);
});

test('Pending erase refuses a changed brush or camera without losing accepted input', t => {
  const {erase,worker}=fixture(t);
  erase.update([0,-.6]);erase.finish();
  assert.equal(erase.begin(.3,eye,planeZ,false),false);
  assert.equal(erase.begin(.2,[eye[0]+1,eye[1],eye[2]],planeZ,false),false);
  worker.reply({edits:[],bricks:[],duration:1});
  assert.equal(erase.active,false);
});

test('Undo cancels a new uncommitted erase while preserving the previous saved stroke', t => {
  const {v,erase,worker}=fixture(t);v.surfaceErase=erase;
  erase.update([0,-.6]);erase.update([.1,-.6]);erase.finish();
  worker.reply({edits:[[1,.2]],bricks:[],duration:1});
  assert.equal(erase.begin(.2,eye,planeZ,false),true);
  erase.update([.7,.6]);erase.finish();
  assert.equal(erase.saved,false);
  assert.equal(restoreHistory(v),true);
  assert.equal(v.field.get(1),.2);
  assert.equal(v.undoStack.length,1);
  worker.reply({edits:[[2,.2]],bricks:[],duration:1});
  assert.equal(v.field.has(2),false);
});

test('No-op erasure creates no history and worker failures release input ownership', t => {
  const {v,erase,worker} = fixture(t);
  erase.update([10,10]); erase.finish(); worker.reply({edits:[],bricks:[],duration:1});
  assert.equal(v.undoStack?.length??0,0); assert.equal(v.cutting,false);
  assert.equal(erase.begin(.2,eye,planeZ,true),true);
  erase.worker.reply({error:'Simulated failure'});
  assert.equal(v.erasing,false); assert.equal(v.cutting,false); assert.equal(erase.active,false);
});

test('Preview follows held input immediately and stays until matching geometry commits', t => {
  const {v,erase,worker}=fixture(t);
  const points=[]; let clears=0;
  v.erasePreview={update:p=>points.push([...p]),clear:()=>clears++};
  erase.update([0,-.6]); erase.update([.1,-.6]);
  assert.deepEqual(points,[[0,-.6],[.1,-.6]]);
  assert.equal(worker.messages.filter(m=>m.type==='erase').length,1);
  erase.finish(); erase.update([99,99]); assert.equal(points.length,2);
  assert.equal(clears,0);
  worker.reply({edits:[[1,.2]],bricks:[],duration:1}); assert.equal(clears,0);
  worker.reply({edits:[[2,.2]],bricks:[],duration:1}); assert.equal(clears,1);
});

test('A long curved erase saves every previewed point even when processing falls behind',t=>{
  const {v,erase,worker}=fixture(t),preview=[];
  v.erasePreview={update:p=>preview.push([...p]),clear(){}};
  for(let i=0;i<140;i++)erase.update([.4*Math.cos(i*.08),.4*Math.sin(i*.08)]);
  erase.finish();
  let batches=0;
  while(!worker.terminated && batches++<10)worker.reply({edits:[],bricks:[],duration:1});
  assert.equal(worker.terminated,true);
  const saved=worker.messages.filter(m=>m.type==='erase').flatMap(m=>m.points);
  assert.deepEqual(saved,preview);
  assert.equal(saved.length,140);
});

test('Slow erase keeps the worker and preview until the result actually commits',t=>{
  const {v,erase,worker,events}=fixture(t);
  const original=globalThis.setTimeout;let warning;
  globalThis.setTimeout=(callback,ms)=>{if(ms===10000)warning=callback;return 0;};
  t.after(()=>{globalThis.setTimeout=original;});
  let clears=0;v.erasePreview={update(){},clear(){clears++;}};
  erase.update([0,-.6]);erase.finish();warning();
  assert.equal(erase.active,true);assert.equal(clears,0);
  assert.equal(worker.terminated,undefined);
  assert.ok(events.some(e=>e.pending));
  worker.reply({edits:[[1,.2]],bricks:[],duration:12000});
  assert.equal(v.field.get(1),.2);assert.equal(clears,1);
});

test('A reply from an aborted erase cannot overwrite a newer stroke',t=>{
  const {v,erase,worker}=fixture(t);
  erase.update([0,0]);erase.abort();
  assert.equal(erase.begin(.2,eye,planeZ,false),true);
  const current=erase.worker;
  worker.reply({edits:[[1,.8]],bricks:[],duration:1});
  assert.equal(v.field.has(1),false);assert.equal(erase.worker,current);assert.equal(erase.active,true);
});


test('A stalled erase releases ownership at the deadline and ignores its late reply',t=>{
  const {v,erase,worker,events}=fixture(t),original=globalThis.setTimeout;let timeout;
  globalThis.setTimeout=(callback,ms)=>{if(ms===15000)timeout=callback;return 0;};
  t.after(()=>{globalThis.setTimeout=original;});
  erase.update([0,-.6]);erase.finish();timeout();
  assert.equal(erase.active,false);assert.equal(v.erasing,false);assert.equal(v.cutting,false);
  assert.equal(worker.terminated,true);assert.ok(events.some(e=>e.error));
  worker.reply({edits:[[1,.8]],bricks:[],duration:16000});assert.equal(v.field.has(1),false);
});

test('Undo cancels an uncommitted erase without undoing an older edit',t=>{
  const {v,erase,worker}=fixture(t);v.surfaceErase=erase;checkpoint(v);
  erase.update([0,-.6]);erase.finish();
  assert.equal(restoreHistory(v),true);assert.equal(worker.terminated,true);
  assert.equal(v.undoStack.length,1);assert.equal(v.cutting,false);
  worker.reply({edits:[[1,.8]],bricks:[],duration:1});assert.equal(v.field.has(1),false);
});

test('Undo during an erase restores already committed portions and stops pending work',t=>{
  const {v,erase,worker}=fixture(t);v.surfaceErase=erase;
  erase.update([0,-.6]);erase.update([.1,-.6]);
  worker.reply({edits:[[1,.2]],bricks:[],duration:1});
  assert.equal(v.field.get(1),.2);assert.equal(erase.busy,true);
  assert.equal(restoreHistory(v),true);assert.equal(v.field.has(1),false);
  assert.equal(worker.terminated,true);assert.equal(v.cutting,false);
  worker.reply({edits:[[2,.2]],bricks:[],duration:1});assert.equal(v.field.has(2),false);
});


test('Release deadline ends a long queue even if individual batches keep completing',t=>{
  const {v,erase,worker}=fixture(t),original=globalThis.setTimeout;const deadlines=[];
  globalThis.setTimeout=(callback,ms)=>{if(ms===15000)deadlines.push(callback);return 0;};
  t.after(()=>{globalThis.setTimeout=original;});
  for(let i=0;i<70;i++)erase.update([i*.01,-.6]);
  erase.finish();const releaseDeadline=deadlines.at(-1);
  worker.reply({edits:[[1,.2]],bricks:[],duration:1});
  assert.equal(erase.active,true);releaseDeadline();
  assert.equal(erase.active,false);assert.equal(v.cutting,false);
  assert.equal(v.field.get(1),.2,'completed changes remain undoable');
  assert.equal(v.undoStack.length,1);
});
