import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SurfaceCleanup} from '../src/surfaceCleanup.js';
import {attachMeshQueue} from '../src/meshQueue.js';
import {SurfacePull} from '../src/surfacePull.js';
import {ClayVolume} from '../src/clayVolume.js';

function fixture(t) {
  const workers=[],installed=[];let busy=false;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,.1,0,0,0,.1,0],3));
  const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);
  const volume={bricks:new Map([['4,4,4',{mesh}]]),serialize:()=>({revision:1})};
  const makeWorker=()=>{const worker={messages:[],postMessage(data){this.messages.push(data);},terminate(){this.terminated=true;}};workers.push(worker);return worker;};
  const cleanup=new SurfaceCleanup(volume,brick=>installed.push(brick),()=>busy,{delay:10000,createWorker:makeWorker});
  const reply=(worker,job,x=1)=>worker.onmessage({data:{id:1,generation:job.generation,bricks:job.keys.map(key=>({key,x}))}});
  t.after(()=>{cleanup.dispose();geometry.dispose();material.dispose();});
  return {cleanup,volume,workers,installed,reply,setBusy(value){busy=value;}};
}

test('Cleanup publishes full-resolution batches together while retaining the editable mesh',t=>{
  const f=fixture(t),mesh=f.volume.bricks.get('4,4,4').mesh;
  f.cleanup.request();f.cleanup.start();
  const worker=f.workers[0];let index=0;
  assert.equal(worker.messages[0].step,1);
  assert.equal(f.volume.bricks.get('4,4,4').mesh,mesh);
  f.reply(worker,worker.messages[index++]);assert.equal(f.installed.length,0);
  while(f.cleanup.running)f.reply(worker,worker.messages[index++]);
  assert.ok(f.installed.length>2);assert.equal(f.cleanup.pending,false);
  f.cleanup.request();f.cleanup.start();assert.equal(f.workers.length,1,'completed worker is reused');
});

test('A local pull only schedules its repair cells and merges unfinished earlier repairs',t=>{
  const f=fixture(t);
  f.cleanup.request(['4,4,4']);f.cleanup.start();
  const first=f.workers[0];assert.deepEqual(first.messages[0].keys,['4,4,4']);
  f.cleanup.pause();f.cleanup.request(['5,4,4']);f.cleanup.start();
  const latest=f.workers.at(-1),keys=latest.messages[0].keys;
  assert.deepEqual(new Set(keys),new Set(['4,4,4','5,4,4']));
  assert.equal(first.terminated,true);
});

test('New input terminates cleanup immediately; late results cannot overwrite the new revision',t=>{
  const f=fixture(t);f.cleanup.request();f.cleanup.start();
  const staleWorker=f.workers[0],stale=staleWorker.messages[0];
  f.cleanup.pause();assert.equal(staleWorker.terminated,true);
  f.reply(staleWorker,stale,99);assert.equal(f.installed.length,0);
  f.volume.serialize=()=>({revision:2});f.cleanup.resume();f.cleanup.start();
  const latestWorker=f.workers[1];assert.equal(latestWorker.messages[0].state.revision,2);
  f.reply(staleWorker,stale,99);assert.equal(f.installed.length,0);
  let index=0;while(f.cleanup.running)f.reply(latestWorker,latestWorker.messages[index++],2);
  assert.ok(f.installed.every(brick=>brick.x===2));
});

test('Foreground work takes priority; reset and disposal discard staged cleanup',t=>{
  const f=fixture(t);f.setBusy(true);f.cleanup.request();f.cleanup.start();assert.equal(f.workers.length,0);
  f.setBusy(false);f.cleanup.start();const worker=f.workers[0],job=worker.messages[0];
  f.reply(worker,job);assert.equal(f.installed.length,0);
  f.cleanup.cancel();assert.equal(f.cleanup.pending,false);
  f.reply(worker,job);assert.equal(f.installed.length,0);
  f.cleanup.request();f.cleanup.start();f.cleanup.dispose();
  assert.equal(f.workers.at(-1).terminated,true);
});

test('Queue marks a post-Pull cleanup as refining, never as blocked input',t=>{
  const previousWorker=globalThis.Worker;
  globalThis.Worker=class{postMessage(){}terminate(){}};
  const volume={bricks:new Map(),serialize:()=>({shape:'full',field:[]})};
  const queue=attachMeshQueue(volume);
  t.after(()=>{queue.dispose();globalThis.Worker=previousWorker;});
  queue.remeshSurface();assert.equal(queue.pending,false);assert.equal(queue.refining,true);
  queue.pauseRefinement();assert.equal(queue.pending,false);
  queue.invalidate();assert.equal(queue.refining,true,'new edits pause cleanup without forgetting the unfinished repair');
  queue.reset();assert.equal(queue.refining,true);
  queue.resumeRefinement();assert.equal(queue.pending,false);
});

test('A new Pull begins immediately while previous cleanup is pending',t=>{
  const previousWorker=globalThis.Worker;
  globalThis.Worker=class{postMessage(){}terminate(){}};
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.7,.1,0,.7,0,.1,.7],3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  const material=new THREE.MeshBasicMaterial(),parent=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  Object.assign(volume,{material,parent,bricks:new Map([['4,4,5',{mesh}]])});parent.add(mesh);
  volume.meshQueue=attachMeshQueue(volume);const pull=new SurfacePull(volume,()=>{});
  t.after(()=>{pull.abort();volume.meshQueue.dispose();geometry.dispose();material.dispose();globalThis.Worker=previousWorker;});
  volume.meshQueue.remeshSurface();
  assert.equal(volume.meshQueue.refining,true);
  assert.equal(pull.begin(new THREE.Vector3(0,0,.7),.2,.5),true);
  assert.equal(pull.active,true);assert.equal(volume.meshQueue.pending,false);
});
