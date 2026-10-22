import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { enablePaintMaterial,applyVertexPaint,refreshPaint,samplePaint,hasPaint } from '../src/paintLayer.js';
import { syncPaintTexture } from '../src/paintTexture.js';
import { fillPaintTexture } from '../src/paintTextureData.js';
import { PaintTextureQueue } from '../src/paintTextureQueue.js';
import { makeWarp } from '../src/maskWarp.js';

function fixture(t,WorkerClass) {
  const previous=globalThis.Worker;globalThis.Worker=WorkerClass;
  const volume=ClayVolume.fromState({shape:'full',field:[],paint:[['0,0,0',[1,.2,0,1]]],paintCell:.02});
  volume.material=new THREE.MeshBasicMaterial();enablePaintMaterial(volume.material);
  const geometry=new THREE.BoxGeometry(.2,.2,.1).toNonIndexed();
  volume.bricks=new Map([['0,0,0',{mesh:new THREE.Mesh(geometry,volume.material)}]]);
  applyVertexPaint(volume,geometry);volume.material.onBeforeRender();
  const state=volume.material.userData.surfacePaint,original=state.texture;
  volume.pullSource=volume.snapshot();volume.pullWarp=makeWarp([0,0,0],[.04,0,0],.3);volume.paint=new Map();
  applyVertexPaint(volume,geometry);
  const sync=()=>syncPaintTexture(state,volume,()=>assert.fail('full inherited paint must not sample on the drawing thread'),hasPaint);
  t.after(()=>{volume.material.dispose();geometry.dispose();if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;});
  return {volume,state,geometry,original,sync};
}

class MockWorker {
  static instances=[];
  constructor(){this.messages=[];MockWorker.instances.push(this);}
  postMessage(data){this.messages.push(structuredClone(data));}
  terminate(){this.terminated=true;}
  reply(request=this.messages.at(-1),value=100){this.onmessage({data:{id:request.id,pixels:new Uint8Array(request.size.reduce((a,b)=>a*b,1)*4).fill(value),durationMs:3000}});}
}

test('Inherited paint builds in the actual worker while the main loop continues, with identical pixels',async t=>{
  const workers=[];
  class BrowserWorker {
    constructor(url){
      this.worker=new NodeWorker(new URL('./helpers/browserWorker.mjs',import.meta.url),{workerData:{url:url.href}});
      this.result=new Promise((resolve,reject)=>{
        this.worker.on('message',data=>{this.onmessage({data});resolve(data);});
        this.worker.on('error',reject);
      });workers.push(this);
    }
    postMessage(data){this.request=data;this.worker.postMessage(data);}
    terminate(){this.worker.terminate();}
  }
  const f=fixture(t,BrowserWorker);
  f.sync();assert.equal(workers.length,1);assert.equal(f.state.texture,f.original);
  let ticks=0;const timer=setInterval(()=>ticks++,5);t.after(()=>clearInterval(timer));
  const data=await workers[0].result;clearInterval(timer);
  assert.equal(data.error,undefined);assert.ok(ticks>0,'the main thread runs during the paint build');
  const request=workers[0].request,source=ClayVolume.fromState(request.state);
  const expected=fillPaintTexture(new Uint8Array(data.pixels.length),request,(x,y,z)=>samplePaint(source,x,y,z));
  assert.deepEqual(f.state.texture.image.data,expected);
  assert.notEqual(f.state.texture,f.original);assert.equal(f.state.pendingBuild,false);
  const texture=f.state.texture,version=texture.version;
  applyVertexPaint(f.volume,f.geometry);f.sync();
  assert.equal(f.state.texture,texture);assert.equal(texture.version,version,'cleanup does not rebuild unchanged paint');
});

test('Geometry arriving during a paint build reuses its result instead of discarding or rebuilding it',t=>{
  const f=fixture(t,MockWorker);f.sync();const worker=MockWorker.instances.at(-1);
  applyVertexPaint(f.volume,f.geometry);worker.reply();
  assert.equal(f.state.texture,f.original,'completion waits to reconcile dirty geometry');
  f.sync();assert.notEqual(f.state.texture,f.original);assert.equal(worker.messages.length,1);
});

test('New paint supersedes pending work and Undo to unpainted clay cannot install a late texture',t=>{
  const f=fixture(t,MockWorker);f.sync();const worker=MockWorker.instances.at(-1),first=worker.messages[0];
  f.volume.paint.set('1,1,0',[0,1,0,1]);refreshPaint(f.volume,new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(.04,.04,.04)));f.sync();
  f.volume.paint.set('2,1,0',[0,0,1,1]);refreshPaint(f.volume,new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(.06,.04,.04)));f.sync();
  assert.equal(worker.messages.length,1,'new requests coalesce while the old build runs');
  worker.reply(first,30);assert.equal(f.state.texture,f.original,'obsolete completion cannot overwrite current paint');
  assert.equal(worker.messages.length,2);const latest=worker.messages[1];
  assert.equal(latest.state.paint.length,2,'the latest full snapshot includes both strokes');
  worker.reply(latest,90);assert.equal(f.state.texture.image.data[0],90);
  refreshPaint(f.volume);f.sync();const pending=worker.messages.at(-1);
  f.volume.paint=new Map();f.volume.pullSource=null;refreshPaint(f.volume);f.sync();
  assert.equal(f.state.uniforms.paintEnabled.value,0);worker.reply(pending,255);
  assert.equal(f.state.uniforms.paintEnabled.value,0,'Undo remains unpainted after a late result');
});

test('Disposing paint terminates background work and rejects its callback',t=>{
  const f=fixture(t,MockWorker);f.sync();const worker=MockWorker.instances.at(-1);
  f.volume.material.dispose();assert.equal(worker.terminated,true);worker.reply();
  assert.equal(f.state.texture,f.original);
});

test('Paint worker failure keeps the previous complete texture and permits a later retry',()=>{
  const worker=new MockWorker(),errors=[],results=[];
  const queue=new PaintTextureQueue(data=>results.push(data),error=>errors.push(error),{createWorker:()=>worker});
  queue.request({size:[1,1,1]});worker.onerror({message:'simulated failure'});
  assert.deepEqual(errors,['simulated failure']);assert.equal(worker.terminated,true);
  queue.request({size:[1,1,1]});worker.reply();assert.equal(results.length,1);queue.dispose();
});
