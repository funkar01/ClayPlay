import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { attachMeshQueue } from '../src/meshQueue.js';
import { SurfaceExtrude } from '../src/surfaceExtrude.js';
import { restoreHistory } from '../src/sculptHistory.js';

const until=async predicate=>{
  const deadline=Date.now()+25000;
  while(!predicate()) {if(Date.now()>deadline)throw new Error('Geometry queue did not finish');await new Promise(resolve=>setTimeout(resolve,10));}
};

test('Real worker reuses completed geometry, accepts queued previews, and invalidates safely after other edits', {timeout:30000},async t=>{
  const priorWorker=globalThis.Worker,priorDocument=globalThis.document,workers=[];
  globalThis.document=new EventTarget();
  globalThis.Worker=class {
    constructor(url) {
      this.messages=[];this.worker=new NodeWorker(new URL('./helpers/browserWorker.mjs',import.meta.url),{workerData:{url:url.href}});
      this.worker.on('message',data=>this.onmessage?.({data}));
      this.worker.on('error',error=>this.onerror?.({message:error.message}));workers.push(this);
    }
    postMessage(data){this.messages.push(structuredClone(data));this.worker.postMessage(data);}
    terminate(){this.worker.terminate();}
  };
  const v=ClayVolume.fromState({shape:'full',field:[],paint:[['25,25,20',[1,0,0,1]]]});
  Object.assign(v,{bricks:new Map(),parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial()});
  v.meshQueue=attachMeshQueue(v);
  const tool=v.surfaceExtrude=new SurfaceExtrude(v,()=>{});
  t.after(()=>{tool.abort();v.meshQueue.dispose();for(const worker of workers)worker.terminate();v.material.dispose();globalThis.Worker=priorWorker;globalThis.document=priorDocument;});
  v.rebuildBrick(5,5,5);await until(()=>!v.meshQueue.pending);
  const worker=workers[0];assert.deepEqual(worker.messages[0].state.paint,[],'geometry messages omit pigment cells');
  const draw=(x,color)=>{
    assert.ok(tool.begin(new THREE.Vector3(x,.7,.4),.2,false,color));
    tool.update(new THREE.Vector3(x,1,.8));const preview=tool.preview;tool.finish();return preview;
  };
  const first=draw(.7,'#ff0000'),second=draw(-.7,'#0000ff');
  assert.equal(tool.queue.length,1);assert.ok(v.parent.children.includes(first));assert.ok(v.parent.children.includes(second));
  assert.equal(tool.canBegin,true,'background work must leave capacity for another stroke');
  await until(()=>!tool.committing && !tool.queue.length && !v.meshQueue.pending);
  const appends=worker.messages.filter(message=>message.appendExtrusion);
  assert.equal(appends.length,2);assert.ok(appends.every(message=>message.state===undefined));
  assert.ok(v.sample(.7,.98,.78)<0);assert.ok(v.sample(-.7,.98,.78)<0);
  assert.equal(v.undoStack.length,2);assert.ok(!v.parent.children.includes(first));assert.ok(!v.parent.children.includes(second));
  const warmedReference=ClayVolume.fromState(structuredClone(v.serialize()));
  Object.assign(warmedReference,{parent:new THREE.Group(),material:null,bricks:new Map()});
  for(const name of appends[1].keys.slice(0,2)) {
    warmedReference.rebuildBrick(...name.split(',').map(Number));
    const expected=warmedReference.bricks.get(name)?.mesh.geometry,actual=v.bricks.get(name)?.mesh.geometry;
    assert.equal(Boolean(actual),Boolean(expected));
    if(expected)for(const attribute of ['position','normal','extrudeColor'])assert.deepEqual(actual.getAttribute(attribute)?.array,expected.getAttribute(attribute)?.array);
  }

  // A voxel/erase/Undo revision invalidates the warm-worker shortcut.
  const key=v.nodeKey(100,80,110);v.field.set(key,.123);v.meshQueue.invalidate();
  draw(.2,'#00ff00');await until(()=>!tool.committing && !v.meshQueue.pending);
  const reset=worker.messages.findLast(message=>message.reset && message.state);
  assert.ok(reset.state.extrudeSource.field.some(([id,value])=>id===key && value===.123));
  assert.equal(reset.appendExtrusion,null);
  assert.ok(v.serialize().extrudeSource.extrudeSource.extrudeSource.paint.length,'saved pigment survives geometry-only serialization');

  const saved=structuredClone(v.serialize());
  const reference=ClayVolume.fromState(saved);
  Object.assign(reference,{parent:new THREE.Group(),material:null,bricks:new Map()});
  // Compare complete installed positions, normals and extrusion colors to a
  // fresh rebuild of the exact same history, including the voxel edit.
  for(const name of reset.keys.slice(0,2)) {
    reference.rebuildBrick(...name.split(',').map(Number));
    const expected=reference.bricks.get(name)?.mesh.geometry,actual=v.bricks.get(name)?.mesh.geometry;
    assert.equal(Boolean(actual),Boolean(expected));
    if(expected)for(const attribute of ['position','normal','extrudeColor'])assert.deepEqual(actual.getAttribute(attribute)?.array,expected.getAttribute(attribute)?.array);
  }
  assert.ok(restoreHistory(v));assert.ok(restoreHistory(v,true));assert.deepEqual(v.serialize(),saved);
});
