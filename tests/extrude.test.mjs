import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { taperedStroke,extrusionDistance,blendExtrusion } from '../src/extrudeGeometry.js';
import { ClayVolume } from '../src/clayVolume.js';
import { SurfaceExtrude } from '../src/surfaceExtrude.js';
import { checkpoint,restoreHistory } from '../src/sculptHistory.js';
import { makeWarp,forwardWarp } from '../src/maskWarp.js';

test('New extrusions preview immediately while full-detail strokes commit in order',async t=>{
  const oldDocument=globalThis.document;
  globalThis.document=new EventTarget();
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  let pending=false,commits=0;
  Object.assign(volume,{parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial(),bricks:new Map(),
    meshQueue:{get pending(){return pending;},reset(){pending=true;},pauseRefinement(){},resumeRefinement(){},flush(){}},rebuildBrick(){}});
  const tool=volume.surfaceExtrude=new SurfaceExtrude(volume,()=>commits++);
  t.after(()=>{tool.abort();volume.material.dispose();globalThis.document=oldDocument;});
  const stroke=(x)=>{
    assert.equal(tool.begin(new THREE.Vector3(x,0,.7),.2,false),true);
    tool.update(new THREE.Vector3(x,.4,.8));
    const preview=tool.preview;tool.finish();return preview;
  };
  const first=stroke(.3),second=stroke(-.3);
  assert.equal(commits,1,'next stroke must not reset the in-flight worker');
  assert.equal(tool.queue.length,1);
  assert.ok(volume.parent.children.includes(first));
  assert.ok(volume.parent.children.includes(second));
  pending=false;tool.onMeshReady();await Promise.resolve();
  assert.equal(commits,2);
  assert.equal(volume.undoStack.length,2);
  assert.ok(!volume.parent.children.includes(first));
  assert.ok(volume.parent.children.includes(second));
  assert.ok(volume.sample(.3,.35,.79)<0,'first deformation survives the second');
  assert.ok(volume.sample(-.3,.35,.79)<0);
  pending=false;tool.onMeshReady();await Promise.resolve();
  assert.equal(tool.committing,false);
  assert.equal(tool.queue.length,0);
  assert.ok(!volume.parent.children.includes(second));
});

test('Publishing an extrusion does not remove the next live preview',async t=>{
  const oldDocument=globalThis.document;globalThis.document=new EventTarget();
  const volume=ClayVolume.fromState({shape:'full',field:[]});let pending=false;
  Object.assign(volume,{parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial(),bricks:new Map(),
    meshQueue:{get pending(){return pending;},reset(){pending=true;}},rebuildBrick(){}});
  const tool=volume.surfaceExtrude=new SurfaceExtrude(volume,()=>{});
  t.after(()=>{tool.abort();volume.material.dispose();globalThis.document=oldDocument;});
  tool.begin(new THREE.Vector3(.3,0,.7),.2,false);tool.update(new THREE.Vector3(.3,.4,.8));tool.finish();
  tool.begin(new THREE.Vector3(-.3,0,.7),.2,false);tool.update(new THREE.Vector3(-.3,.4,.8));
  const preview=tool.preview;
  pending=false;tool.onMeshReady();await Promise.resolve();
  assert.equal(tool.active,true);
  assert.ok(volume.parent.children.includes(preview));
  tool.finish();assert.equal(volume.undoStack.length,2);
});

test('Extrusion follows a bent path with a broad base and narrow released tip',()=>{
  const stroke=taperedStroke([[0,0,.65],[.5,0,.8],[.5,.6,1]],.2,true);
  assert.equal(stroke.radii[0],.2);
  assert.ok(stroke.radii[2]<.04);
  assert.ok(extrusionDistance(.5,.6,1,stroke)<0);
  assert.ok(extrusionDistance(-.5,.6,1,stroke)<0);
  assert.ok(extrusionDistance(.58,.6,1,stroke)>0);
  assert.ok(extrusionDistance(.05,.1,.665,stroke)<0);
});

test('Extrusion starts flush instead of adding a spherical bulge behind its attachment',()=>{
  const stroke=taperedStroke([[0,0,0],[1,0,0]],.2);
  assert.ok(extrusionDistance(-.1,0,0,stroke)>0);
  assert.ok(Math.abs(extrusionDistance(0,0,0,stroke))<1e-12);
  assert.ok(extrusionDistance(.1,.1,0,stroke)<0);
});

test('Local extrusion pruning preserves the exact blended surface',()=>{
  const stroke=taperedStroke([[0,0,.6],[.2,.3,.7],[.7,.5,.8]],.16,true);
  for(let x=-1;x<=1;x+=.08)for(let y=-.2;y<=.8;y+=.1){
    const source=.2*Math.sin(x*3)+.1*y;
    const exact=blendExtrusion(source,extrusionDistance(x,y,.7,stroke),.16);
    const pruned=blendExtrusion(source,extrusionDistance(x,y,.7,stroke,source+.035),.16);
    assert.ok(Math.abs(exact-pruned)<1e-10);
  }
});

test('Extrude follows input beyond the old box and schedules sparse exterior geometry',()=>{
  globalThis.document ??=new EventTarget();
  const volume=ClayVolume.fromState({shape:'full',field:[]}),keys=[];
  Object.assign(volume,{parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial(),bricks:new Map(),rebuildBrick:(...key)=>keys.push(key)});
  const tool=new SurfaceExtrude(volume,()=>{});
  tool.begin(new THREE.Vector3(.7,.5,.6),.3,true);
  for(const x of [1,2,2.5,3,3.5,4])tool.update(new THREE.Vector3(x,.5,.8));
  assert.ok(Math.abs(tool.stroke.points.at(-1)[0]-4)<1e-10);
  tool.finish();
  assert.equal(volume.extrusion.points.at(-1)[0],4);
  assert.ok(keys.some(([x])=>x>=8));
  assert.ok(keys.some(([x])=>x<0));
  assert.ok(volume.sample(4,.5,.8)<0);
  const restored=ClayVolume.fromState(structuredClone(volume.serialize()));
  assert.ok(restored.sample(-4,.5,.8)<0);
  tool.abort();volume.material.dispose();
});

test('Exterior nodes stay unique, interpolate edits, and generate actual mesh outside the old box',()=>{
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  assert.notEqual(volume.nodeKey(193,0,0),volume.nodeKey(0,1,0));
  assert.notEqual(volume.nodeKey(-1,1,0),volume.nodeKey(192,0,0));
  volume.extrudeSource=volume.snapshot();
  volume.extrusion=taperedStroke([[1,0,.7],[4.1,0,.7]],.15);
  Object.assign(volume,{parent:new THREE.Group(),material:new THREE.MeshBasicMaterial(),bricks:new Map()});
  volume.rebuildBrick(10,4,5);
  assert.ok(volume.bricks.get('10,4,5')?.mesh.geometry.attributes.position.count>0);
  const index=[260,96,124],key=volume.nodeKey(...index);
  volume.field.set(key,.2);
  assert.ok(Math.abs(volume.sample(4.1,0,.7)-.2)<1e-10);
  const restored=ClayVolume.fromState(structuredClone(volume.serialize()));
  assert.ok(Math.abs(restored.sample(4.1,0,.7)-.2)<1e-10);
  for(const {mesh}of volume.bricks.values())mesh.geometry.dispose();volume.material.dispose();
});

test('Tapered sweep is invariant to subdivisions of a straight segment',()=>{
  const whole=taperedStroke([[0,0,0],[1,0,0]],.2,false,false);
  const split=taperedStroke([[0,0,0],[.25,0,0],[.5,0,0],[.75,0,0],[1,0,0]],.2,false,false);
  for(let x=-.1;x<1.2;x+=.025) for(const y of [.05,.1,.2,.3]) {
    assert.ok(Math.abs(extrusionDistance(x,y,0,whole)-extrusionDistance(x,y,0,split))<1e-10);
  }
  assert.ok(blendExtrusion(0,0,.2)<0);
  assert.equal(blendExtrusion(-.2,1,.2),-.2);
});

test('Fine curved movements remain in the live stroke and release keeps the final endpoint',()=>{
  globalThis.document ??=new EventTarget();
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  Object.assign(volume,{parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial(),bricks:new Map(),rebuildBrick(){}});
  const tool=new SurfaceExtrude(volume,()=>{});
  tool.begin(new THREE.Vector3(0,0,.7),.1,false);
  for(let i=1;i<=24;i++) {
    const a=i*Math.PI/24;
    tool.update(new THREE.Vector3(.15*Math.sin(a),.15*(1-Math.cos(a)),.7+i*.002));
  }
  assert.ok(tool.points.length>12);
  assert.equal(tool.preview.children[0].geometry.parameters.radialSegments,32);
  assert.ok(tool.stroke.points.some(p=>p[0]>.14));
  const endpoint=[...tool.stroke.points.at(-1)];
  tool.finish();
  assert.deepEqual(volume.extrusion.points.at(-1),endpoint);
  tool.update(new THREE.Vector3(1,1,1));
  assert.deepEqual(volume.extrusion.points.at(-1),endpoint);
  volume.material.dispose();
});

test('Extruded field serializes, deforms, and can be erased with voxel edits',()=>{
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  volume.extrudeSource=volume.snapshot();
  volume.extrusion=taperedStroke([[.7,.7,.2],[1.1,1,1],[1.5,1.2,1.1]],.15);
  const restored=ClayVolume.fromState(structuredClone(volume.serialize()));
  assert.ok(restored.sample(1.5,1.2,1.1)<0);
  const warp=makeWarp([1.5,1.2,1.1],[.05,.05,0],.2);
  const pulled=ClayVolume.fromState({shape:'full',field:[]});
  pulled.pullSource=restored.snapshot(); pulled.pullWarp=warp;
  assert.ok(pulled.sample(...forwardWarp(1.5,1.2,1.1,warp))<0);
  const key=restored.nodeKey(156,144,140);
  restored.field.set(key,.2);
  assert.equal(restored.nodeValue(156,144,140),.2);
});

test('Extrude freezes at release, creates one undo entry, and retains previous source',()=>{
  globalThis.document ??=new EventTarget();
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  Object.assign(volume,{parent:new THREE.Group(),material:new THREE.MeshPhysicalMaterial(),bricks:new Map(),rebuildSurface(){},rebuildBrick(){}});
  let changes=0;
  const tool=new SurfaceExtrude(volume,()=>changes++);
  assert.equal(tool.begin(new THREE.Vector3(0,0,.7),.2,false),true);
  tool.update(new THREE.Vector3(.3,.2,.85)); tool.update(new THREE.Vector3(.7,.5,1));
  assert.ok(tool.preview.children.length<=6);
  tool.finish();
  const state=JSON.stringify(volume.extrusion);
  tool.update(new THREE.Vector3(2,2,2)); tool.finish();
  assert.equal(JSON.stringify(volume.extrusion),state);
  assert.equal(changes,1);assert.equal(volume.undoStack.length,1);
  assert.equal(volume.pulling,false);
  assert.equal(restoreHistory(volume),true);
  assert.equal(volume.extrudeSource,null);
  assert.equal(restoreHistory(volume,true),true);
  assert.ok(volume.extrudeSource);
  checkpoint(volume); // Another tool can retain the new extruded state.
  tool.abort(); volume.material.dispose();
});
