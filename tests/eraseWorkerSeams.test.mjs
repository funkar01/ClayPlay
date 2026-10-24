import test from 'node:test';
import assert from 'node:assert/strict';
import { ClayVolume } from '../src/clayVolume.js';
import { taperedStroke } from '../src/extrudeGeometry.js';
import { projectCutPoint } from '../src/cutGeometry.js';

test('Erase replaces stretched source owners as well as the cells under the brush',async t=>{
  const oldSelf=globalThis.self;let reply;
  globalThis.self={postMessage:data=>{reply=data;}};
  t.after(()=>{globalThis.self=oldSelf;});
  await import('../src/eraseWorker.js');
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  volume.extrudeSource=volume.snapshot();
  volume.extrusion=taperedStroke([[.3,0,.7],[1.4,0,.7]],.15);
  const eye=[0,0,8.6],planeZ=.9;
  self.onmessage({data:{type:'begin',state:volume.serialize(),radius:.06,eye,planeZ,symmetry:false,
    bricks:[{key:'4,4,5',positions:new Float32Array([.1,0,.7,.2,.1,.7,1.4,0,.7])}]}});
  assert.ok(volume.sample(1.25,0,.7)<0,'fixture must contain real clay at the brush');
  self.onmessage({data:{type:'erase',points:[projectCutPoint(1.25,0,.7,eye,planeZ)],breakBefore:true}});
  assert.equal(reply.error,undefined);
  assert.ok(reply.edits.length>0);
  assert.ok(reply.bricks.some(brick=>brick.key==='4,4,5'),'remove the old triangle reaching into the erased cells');
  assert.ok(reply.bricks.some(brick=>brick.key==='5,4,5'),'fill the rest of its surface coverage');
});
