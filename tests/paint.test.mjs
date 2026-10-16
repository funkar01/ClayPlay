import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { SurfacePaint } from '../src/surfacePaint.js';
import { samplePaint,applyVertexPaint,enablePaintMaterial,paintSegment } from '../src/paintLayer.js';
import { restoreHistory } from '../src/sculptHistory.js';
import { makeWarp,forwardWarp } from '../src/maskWarp.js';
import { PullPreview } from '../src/pullPreview.js';

function fixture(t) {
  const oldDocument=globalThis.document;globalThis.document=new EventTarget();
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  Object.assign(volume,{bricks:new Map(),parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial()});
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.7,.1,0,.7,0,.1,.7],3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  const mesh=new THREE.Mesh(geometry,volume.material);volume.parent.add(mesh);volume.bricks.set('4,4,5',{mesh});
  let changes=0;const paint=new SurfacePaint(volume,()=>changes++);
  t.after(()=>{paint.finish();for(const {mesh}of volume.bricks.values())mesh.geometry.dispose();volume.material.dispose();globalThis.document=oldDocument;});
  return {volume,paint,geometry,changes:()=>changes};
}

test('Slow and fast samples give the same soft stroke instead of accumulating granular dabs',()=>{
  const make=()=>({volume:ClayVolume.fromState({shape:'full',field:[]}),changes:new Map(),coverage:new Map(),bases:new Map()});
  const fast=make(),slow=make(),color=new THREE.Color('#2299ff'),normal=new THREE.Vector3(0,0,1);
  const brush=(f,a,b)=>paintSegment(f.volume,new THREE.Vector3(a,0,.7),new THREE.Vector3(b,0,.7),normal,.16,color,f.changes,f.coverage,f.bases);
  brush(fast,-.3,-.3);brush(fast,-.3,.3);
  brush(slow,-.3,-.3);
  for(let i=1;i<=120;i++)brush(slow,-.3+(i-1)*.005,-.3+i*.005);
  for(let x=-.25;x<.3;x+=.04)for(let y=.08;y<.2;y+=.01) {
    const a=samplePaint(fast.volume,x,y,.7),b=samplePaint(slow.volume,x,y,.7);
    assert.ok(a.every((v,i)=>Math.abs(v-b[i])<.003),`coverage differs at ${x},${y}`);
  }
});

test('Paint precision survives save/load and legacy paint remains correctly positioned',()=>{
  const volume=ClayVolume.fromState({shape:'full',field:[],paintCell:.04,paint:[['10,0,0',[1,0,0,1]]]});
  const restored=ClayVolume.fromState(structuredClone(volume.serialize()));
  assert.equal(restored.paintCell,.04);assert.equal(samplePaint(restored,.4,0,0)[3],1);
  const legacy=ClayVolume.fromState({shape:'full',field:[],paint:[['10,0,0',[1,0,0,1]]]});
  assert.equal(legacy.paintCell,.05);assert.equal(samplePaint(legacy,.5,0,0)[3],1);
});

test('Paint sweeps a continuous soft stroke without changing geometry or painting the back',t=>{
  const {volume,paint,geometry,changes}=fixture(t),positions=geometry.attributes.position.array;
  paint.begin(.16,'#2299ff');
  const normal=new THREE.Vector3(0,0,1);
  paint.update(new THREE.Vector3(-.3,0,.7),normal);paint.update(new THREE.Vector3(.3,0,.7),normal);
  assert.equal(geometry.getAttribute('paintColor'),undefined,'color updates are batched until the next frame');
  paint.tick();
  const center=samplePaint(volume,0,0,.7);
  assert.ok(center[2]>.8 && center[3]>.95);
  assert.equal(samplePaint(volume,0,0,.4)[3],0);
  assert.equal(geometry.attributes.position.array,positions);
  assert.equal(volume.field.size,0);assert.ok(volume.paint.size<2000);
  paint.finish();paint.finish();assert.equal(changes(),1);assert.equal(volume.undoStack.length,1);
  assert.equal(volume.undoStack[0].paintOnly,true);
  assert.equal(volume.undoStack[0].bricks,undefined,'paint history stores color changes, not geometry');
});

test('Paint supports symmetry, color changes and lightweight Undo/Redo',t=>{
  const {volume,paint,geometry}=fixture(t),normal=new THREE.Vector3(0,0,1);
  paint.begin(.1,'#2299ff',true);paint.update(new THREE.Vector3(.4,0,.7),normal);paint.finish();
  assert.deepEqual(samplePaint(volume,.4,0,.7),samplePaint(volume,-.4,0,.7));
  const blue=samplePaint(volume,.4,0,.7);
  paint.begin(.1,'#ff2233');paint.update(new THREE.Vector3(0,.3,.7),normal);paint.finish();
  assert.deepEqual(samplePaint(volume,.4,0,.7),blue);
  assert.ok(samplePaint(volume,0,.3,.7)[0]>.9);
  const positions=geometry.attributes.position.array;
  assert.equal(restoreHistory(volume),true);assert.equal(samplePaint(volume,0,.3,.7)[3],0);
  assert.deepEqual(samplePaint(volume,.4,0,.7),blue);
  assert.equal(restoreHistory(volume,true),true);assert.ok(samplePaint(volume,0,.3,.7)[0]>.9);
  assert.equal(geometry.attributes.position.array,positions);
});

test('Paint survives worker serialization, replacement geometry and follows Pull',t=>{
  const {volume,paint}=fixture(t);
  paint.begin(.16,'#2299ff');paint.update(new THREE.Vector3(0,0,.7),new THREE.Vector3(0,0,1));paint.finish();
  const restored=ClayVolume.fromState(structuredClone(volume.serialize()));
  assert.deepEqual(samplePaint(restored,0,0,.7),samplePaint(volume,0,0,.7));
  const warp=makeWarp([0,0,.7],[.2,.1,.1],.3);
  const pulled=ClayVolume.fromState({shape:'full',field:[]});pulled.pullSource=restored;pulled.pullWarp=warp;
  const moved=forwardWarp(0,0,.7,warp);
  assert.ok(samplePaint(pulled,...moved)[2]>.8);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([...moved],3));
  applyVertexPaint(pulled,geometry);
  assert.ok(geometry.attributes.paintColor.getZ(0)>.8);
  const cut=ClayVolume.fromState({shape:'full',field:[]});cut.cutSource=restored;
  assert.deepEqual(samplePaint(cut,0,0,.7),samplePaint(restored,0,0,.7));
  geometry.dispose();
});

test('Painting stops at release and does not connect across missing surface hits',t=>{
  const {volume,paint}=fixture(t),normal=new THREE.Vector3(0,0,1);
  paint.begin(.08,'#ff2233');paint.update(new THREE.Vector3(-.3,0,.7),normal);
  paint.breakPath();paint.update(new THREE.Vector3(.3,0,.7),normal);paint.finish();
  assert.equal(samplePaint(volume,0,0,.7)[3],0);
  const size=volume.paint.size;paint.update(new THREE.Vector3(0,0,.7),normal);paint.tick();
  assert.equal(volume.paint.size,size);
});

test('Paint shader composes with Pull and preserves actual pigments independently of clay color',()=>{
  const material=new THREE.MeshPhysicalMaterial({color:'#000000'});
  enablePaintMaterial(material);new PullPreview(material);
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'};
  material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vPaintColor = paintColor'));
  assert.ok(shader.vertexShader.includes('pullVertex(pullPosition, objectNormal)'));
  assert.ok(shader.fragmentShader.includes('+ vPaintColor.rgb'));
  material.dispose();
});
