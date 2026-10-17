import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachMeshQueue } from '../src/meshQueue.js';

// A revision spans more than one worker batch. No partial surface is visible.
test('Uniform-resolution rebuilding swaps all batches together and rejects stale revisions',async t=>{
  const originalWorker=globalThis.Worker,workers=[];
  globalThis.Worker=class {
    constructor(){workers.push(this);this.messages=[];}
    postMessage(data){this.messages.push(data);}
  };
  const parent=new THREE.Group(),material=new THREE.MeshBasicMaterial();let revision=1;
  const volume={parent,material,shape:'full',bricks:new Map(),serialize:()=>({shape:'full',field:[],revision})};
  const queue=attachMeshQueue(volume),keys=['0,0,0','1,0,0','2,0,0','3,0,0','4,0,0'];
  t.after(()=>{queue.dispose();for(const {mesh}of volume.bricks.values())mesh.geometry.dispose();material.dispose();globalThis.Worker=originalWorker;});
  const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
  const reply=(job,x)=>workers[0].onmessage({data:{id:job.id,generation:job.generation,bricks:job.keys.map(key=>({key,positions:new Float32Array([x,0,0,x+1,0,0,x,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1])}))}});
  keys.forEach(key=>queue.brick(key));await wait();
  const first=workers[0].messages[0];assert.equal(first.step,1);
  reply(first,0);await wait();
  assert.equal(volume.bricks.size,0,'first batch must stay invisible');
  assert.equal(queue.pending,true);
  reply(workers[0].messages[1],0);
  assert.equal(volume.bricks.size,5);assert.equal(queue.pending,false);
  queue.brick(keys[0]);await wait();const stale=workers[0].messages.at(-1);
  revision=2;queue.invalidate();keys.forEach(key=>queue.brick(key));
  reply(stale,99);await wait();
  assert.equal(volume.bricks.get(keys[0]).mesh.geometry.attributes.position.getX(0),0);
  const latest=workers[0].messages.at(-1);assert.equal(latest.state.revision,2);
  reply(latest,2);await wait();
  assert.equal(volume.bricks.get(keys[0]).mesh.geometry.attributes.position.getX(0),0);
  reply(workers[0].messages.at(-1),2);
  assert.equal(volume.bricks.get(keys[0]).mesh.geometry.attributes.position.getX(0),2);
  assert.equal(queue.pending,false);assert.equal(queue.refining,false);
});
