import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachMeshQueue } from '../src/meshQueue.js';

test('Editable draft unlocks before refinement, and a new stroke cancels stale detail updates',async t=>{
  const originalWorker=globalThis.Worker,workers=[];
  globalThis.Worker=class {
    constructor(){workers.push(this);this.messages=[];}
    postMessage(data){this.messages.push(data);}
    terminate(){this.terminated=true;}
  };
  const parent=new THREE.Group(),material=new THREE.MeshBasicMaterial();let revision=1;
  const volume={parent,material,shape:'full',bricks:new Map(),serialize:()=>({shape:'full',field:[],revision})};
  const queue=attachMeshQueue(volume),key='4,4,4';
  t.after(()=>{queue.dispose();for(const {mesh}of volume.bricks.values())mesh.geometry.dispose();material.dispose();globalThis.Worker=originalWorker;});
  const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
  const reply=(worker,message,x)=>worker.onmessage({data:{id:message.id,generation:message.generation,bricks:[{key,positions:new Float32Array([x,0,0,x+1,0,0,x,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1])}]}});
  queue.brick(key);await wait();
  const draft=workers[0],draftJob=draft.messages[0];assert.equal(draftJob.step,2);
  reply(draft,draftJob,0);await wait();
  assert.equal(queue.pending,false);assert.equal(queue.refining,true);
  const fine=workers[1],oldJob=fine.messages[0];assert.equal(oldJob.step,1);
  volume.pulling=true;queue.pauseRefinement();
  assert.equal(fine.terminated,true);
  const currentMesh=volume.bricks.get(key).mesh;
  reply(fine,oldJob,99);
  assert.equal(volume.bricks.get(key).mesh,currentMesh,'old refinement cannot replace the current edit');
  revision=2;queue.invalidate();volume.pulling=false;queue.refine([key]);await wait();
  const latest=workers[2],newJob=latest.messages[0];
  assert.equal(newJob.state.revision,2);assert.notEqual(newJob.generation,oldJob.generation);
  reply(latest,newJob,2);
  assert.equal(volume.bricks.get(key).mesh.geometry.attributes.position.getX(0),2);
  assert.equal(queue.pending,false);assert.equal(queue.refining,false);
});
