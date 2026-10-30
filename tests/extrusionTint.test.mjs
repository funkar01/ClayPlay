import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { taperedStroke } from '../src/extrudeGeometry.js';
import { extrusionTintSampler,applyExtrusionTint } from '../src/extrusionTint.js';
import { enablePaintMaterial,applyVertexPaint,hasPaint } from '../src/paintLayer.js';
import { SurfaceExtrude } from '../src/surfaceExtrude.js';
import { makeWarp,forwardWarp } from '../src/maskWarp.js';
import { restoreHistory } from '../src/sculptHistory.js';
import { anchorVertex } from '../src/pullGeometry.js';

function coloredVolume(color=[1,0,0],symmetry=true) {
  const v=ClayVolume.fromState({shape:'full',field:[]});
  v.extrudeSource=v.snapshot();
  v.extrusion=taperedStroke([[.7,.7,.4],[1.2,1,1],[1.5,1.2,1.1]],.15,symmetry);
  v.extrusion.color=[...color];return v;
}

test('Extrusion color covers new material and its mirror while leaving the original mask alone',()=>{
  const v=coloredVolume(),sample=extrusionTintSampler(v);
  assert.deepEqual(sample(1.5,1.2,1.1),[1,0,0,1]);
  assert.deepEqual(sample(-1.5,1.2,1.1),[1,0,0,1]);
  assert.deepEqual(sample(0,0,.3),[0,0,0,0]);
  assert.deepEqual(sample(2,2,2),[0,0,0,0]);
  assert.equal(extrusionTintSampler(ClayVolume.fromState({shape:'full',field:[]})),null);
});

test('Color is retained through save/load, Pull, Cut and later differently colored extrusions',()=>{
  const original=coloredVolume(),copy=ClayVolume.fromState(structuredClone(original.serialize()));
  assert.deepEqual(extrusionTintSampler(copy)(1.5,1.2,1.1),[1,0,0,1]);
  const pulled=ClayVolume.fromState({shape:'full',field:[]});
  pulled.pullSource=copy;pulled.pullWarp=makeWarp([1.5,1.2,1.1],[.1,.05,0],.2);
  assert.deepEqual(extrusionTintSampler(pulled)(...forwardWarp(1.5,1.2,1.1,pulled.pullWarp)),[1,0,0,1]);
  const cut=ClayVolume.fromState({shape:'full',field:[]});cut.cutSource=copy;
  assert.deepEqual(extrusionTintSampler(cut)(1.5,1.2,1.1),[1,0,0,1]);
  const next=coloredVolume([0,0,1],false);
  next.extrudeSource=copy;next.extrusion=taperedStroke([[-.7,-.7,.4],[-1.2,-1,1],[-1.5,-1.2,1.1]],.15,false);next.extrusion.color=[0,0,1];
  assert.deepEqual(extrusionTintSampler(next)(1.5,1.2,1.1),[1,0,0,1]);
  assert.deepEqual(extrusionTintSampler(next)(-1.5,-1.2,1.1),[0,0,1,1]);
});

test('Vertex tint creates no paint cells or 3D paint texture and reuses worker-prepared attributes',()=>{
  const v=coloredVolume();v.material=new THREE.MeshPhysicalMaterial();enablePaintMaterial(v.material);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([1.5,1.2,1.1,-1.5,1.2,1.1,0,0,.3],3));
  applyVertexPaint(v,geometry);v.material.onBeforeRender();
  const tint=geometry.getAttribute('extrudeColor');assert.ok(tint);
  assert.equal(tint.getW(0),1);assert.equal(tint.getW(1),1);assert.equal(tint.getW(2),0);
  assert.equal(hasPaint(v),false);assert.equal(v.paint.size,0);
  assert.equal(v.material.userData.surfacePaint.texture,undefined);
  const sample=v.extrudeSource.sample;v.extrudeSource.sample=()=>assert.fail('prepared tints must not be sampled on the main thread again');
  applyExtrusionTint(v,geometry);assert.equal(geometry.getAttribute('extrudeColor'),tint);
  v.extrudeSource.sample=sample;geometry.dispose();v.material.dispose();
});

test('Each stroke snapshots the selected preview color and Undo/Redo restores it',t=>{
  const previous=globalThis.document;globalThis.document=new EventTarget();t.after(()=>{globalThis.document=previous;});
  const v=ClayVolume.fromState({shape:'full',field:[]});
  Object.assign(v,{parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial(),bricks:new Map(),rebuildBrick(){}});
  enablePaintMaterial(v.material);
  const tool=new SurfaceExtrude(v,()=>{}),selected=new THREE.Color('#e87967');
  tool.begin(new THREE.Vector3(.7,.7,.4),.3,true,selected);
  selected.set('#0000ff');tool.update(new THREE.Vector3(1.5,1.2,1.1));
  const expected=new THREE.Color('#e87967').toArray();
  const preview=tool.preview.children[0].geometry.getAttribute('extrudeColor');
  assert.ok(preview);assert.ok(Math.abs(preview.getX(0)-expected[0])<1e-6);
  tool.finish();assert.deepEqual(v.extrusion.color,expected);
  assert.ok(restoreHistory(v));assert.equal(extrusionTintSampler(v),null);
  assert.ok(restoreHistory(v,true));assert.deepEqual(v.extrusion.color,expected);
  tool.abort();v.material.dispose();
});

test('Pull anchor subdivision interpolates tint without losing vertex alignment',()=>{
  const brick={positions:new Float32Array([0,0,0,.1,0,0,0,.1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),tints:new Float32Array([1,0,0,1,0,1,0,1,0,0,1,1])};
  anchorVertex([brick],[.02,.02,0]);
  assert.equal(brick.tints.length/4,brick.positions.length/3);
  assert.ok(Math.abs(brick.tints[8]-.6)<1e-6);assert.ok(Math.abs(brick.tints[9]-.2)<1e-6);
  assert.ok(Math.abs(brick.tints[10]-.2)<1e-6);assert.equal(brick.tints[11],1);
});
