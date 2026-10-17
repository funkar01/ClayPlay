import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';

test('Worker sample cache preserves geometry and respects edits and resets',async t=>{
  const previous=globalThis.self;let response;
  globalThis.self={postMessage:data=>{response=data;}};
  t.after(()=>{if(previous===undefined)delete globalThis.self;else globalThis.self=previous;});
  await import('../src/meshWorker.js');
  const state={shape:'full',field:[]},key='2,5,4';
  const request={id:1,generation:0,shape:'full',state,keys:[key],edits:[],reset:true,step:1};
  const expected=edits=>{
    const v=ClayVolume.fromState({...state,field:edits});Object.assign(v,{parent:new THREE.Group(),bricks:new Map(),material:null});
    v.rebuildBrick(2,5,4);const g=v.bricks.get(key).mesh.geometry;
    const out={positions:g.attributes.position.array.slice(),normals:g.attributes.normal.array.slice()};g.dispose();return out;
  };
  self.onmessage({data:request});assert.equal(response.error,undefined);
  const original=expected([]);assert.deepEqual(response.bricks[0].positions,original.positions);
  const edits=[[ClayVolume.prototype.nodeKey(70,128,112),1]];
  self.onmessage({data:{...request,reset:false,state:undefined,edits}});
  const edited=expected(edits);assert.deepEqual(response.bricks[0].positions,edited.positions);assert.deepEqual(response.bricks[0].normals,edited.normals);
  assert.notDeepEqual(edited.positions,original.positions,'edit must alter cached surface nodes');
  self.onmessage({data:{...request,generation:1}});assert.deepEqual(response.bricks[0].positions,original.positions);
  self.onmessage({data:{id:1,remove:true}});
});
