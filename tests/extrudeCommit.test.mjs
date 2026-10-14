import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachMeshQueue } from '../src/meshQueue.js';

test('Extrusion replaces the live preview only after all geometry batches are ready',async t=>{
  const oldWorker=globalThis.Worker;
  let worker,clears=0;
  globalThis.Worker=class {
    constructor(){worker=this;this.messages=[];}
    postMessage(data){this.messages.push(data);}
  };
  const parent=new THREE.Group(),material=new THREE.MeshBasicMaterial();
  const volume={parent,material,shape:'full',bricks:new Map(),serialize:()=>({shape:'full',field:[]})};
  volume.surfaceExtrude={committing:true,clear(){clears++;this.committing=false;}};
  const queue=attachMeshQueue(volume);
  t.after(()=>{queue.dispose();material.dispose();globalThis.Worker=oldWorker;});
  const originals=[];
  for(let i=0;i<5;i++){
    const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);
    originals.push(mesh);parent.add(mesh);volume.bricks.set(`${i},0,0`,{mesh});queue.brick(`${i},0,0`);
  }
  await new Promise(resolve=>setTimeout(resolve,10));
  const reply=message=>worker.onmessage({data:{id:message.id,generation:message.generation,bricks:message.keys.map(key=>({key,positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1])}))}});
  reply(worker.messages[0]);
  assert.equal(clears,0);
  assert.ok(originals.every(mesh=>parent.children.includes(mesh)));
  await new Promise(resolve=>setTimeout(resolve,10));
  reply(worker.messages[1]);
  assert.equal(clears,1);
  assert.ok(originals.every(mesh=>!parent.children.includes(mesh)));
  assert.equal(volume.bricks.size,5);
  for(const {mesh} of volume.bricks.values())mesh.geometry.dispose();
});
