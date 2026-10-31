import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { taperedStroke,extrusionDistance } from '../src/extrudeGeometry.js';
import { extrusionTintSampler,applyExtrusionTint } from '../src/extrusionTint.js';
import { enablePaintMaterial,applyVertexPaint,hasPaint,samplePaint } from '../src/paintLayer.js';
import { SurfaceExtrude } from '../src/surfaceExtrude.js';
import { makeWarp,forwardWarp } from '../src/maskWarp.js';
import { restoreHistory } from '../src/sculptHistory.js';
import { anchorVertex } from '../src/pullGeometry.js';
import { partitionExtrusionMaterials } from '../src/extrusionMaterials.js';

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

test('Meshing errors and the color halo cannot recolor the original surface at the root',()=>{
  const source=ClayVolume.fromState({shape:'full',field:[]});
  // A locally flat source with a small positive meshing error. Both of these
  // points passed the old >0 test despite still belonging to the mask skin.
  source.sample=(x,y,z)=>z;
  const v=ClayVolume.fromState({shape:'full',field:[]});v.extrudeSource=source;
  v.extrusion=taperedStroke([[0,0,-.055],[.4,0,.2],[.8,0,.3]],.1,true);v.extrusion.color=[0,1,1];
  const sample=extrusionTintSampler(v);
  for(const z of [0,.00001,.002,.008,.012])for(const x of [-.04,0,.04])assert.deepEqual(sample(x,.12,z),[0,0,0,0]);
  assert.deepEqual(sample(.06,0,.015),[0,1,1,1],'new material starts at the actual join, without a mask-colored collar');
  assert.deepEqual(sample(.8,0,.3),[0,1,1,1]);assert.deepEqual(sample(-.8,0,.3),[0,1,1,1]);
  // A nearby mask point can be within the broad .04 lookup halo while the
  // old surface is closer than the actual extrusion surface.
  const point=[.06,.12,.015];assert.ok(extrusionDistance(...point,v.extrusion)<.04);
  assert.deepEqual(sample(...point),[0,0,0,0]);
  let queries=0;source.sample=(x,y,z)=>{queries++;return z;};
  sample(.8,0,.3);assert.equal(queries,1,'boundary ownership must reuse a single source-distance query');
  sample(5,5,5);assert.equal(queries,1,'points outside the extrusion bounds add no source queries');
});

test('A new extrusion preserves earlier extrusion colors at its attachment',()=>{
  const source=coloredVolume([1,0,0],false);
  source.sample=()=>.005;
  const v=ClayVolume.fromState({shape:'full',field:[]});v.extrudeSource=source;
  v.extrusion=taperedStroke([[1.5,1.3,1.04],[1.8,1.3,1.3]],.07,false);v.extrusion.color=[0,0,1];
  assert.deepEqual(extrusionTintSampler(v)(1.5,1.2,1.1),[1,0,0,1]);
});

test('A crossing triangle is split at the material seam without mixing colors or moving its surface',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,1,1,0],3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  const tree={base:null,color:[0,.7,.3,1],margin:x=>x};
  assert.ok(partitionExtrusionMaterials(geometry,tree));
  const positions=geometry.attributes.position,colors=geometry.attributes.extrudeColor;let area=0;
  for(let i=0;i<positions.count;i+=3) {
    const alpha=colors.getW(i);assert.ok(alpha===0 || alpha===1);
    for(let j=0;j<3;j++) {
      assert.equal(colors.getW(i+j),alpha,'a face must never interpolate across material colors');
      assert.equal(positions.getZ(i+j),0);assert.ok(alpha?positions.getX(i+j)>=0:positions.getX(i+j)<=0);
    }
    const a=new THREE.Vector3().fromBufferAttribute(positions,i),b=new THREE.Vector3().fromBufferAttribute(positions,i+1),c=new THREE.Vector3().fromBufferAttribute(positions,i+2);
    const cross=b.sub(a).cross(c.sub(a));assert.ok(cross.z>0,'face winding is preserved');area+=cross.length()/2;
  }
  assert.ok(Math.abs(area-1)<1e-12,'the split must not add a bump, gap or overlap');
  const before=positions.array.slice();
  partitionExtrusionMaterials(geometry,tree);
  assert.deepEqual(geometry.attributes.position.array,before,'restoring or remeshing a clean seam cannot keep subdividing it');
  geometry.dispose();
});

test('Painted mask pigment stays on its own material and later painting can color the extrusion',()=>{
  const source=ClayVolume.fromState({shape:'full',field:[]});source.sample=(x,y,z)=>z;
  for(let x=-5;x<=5;x++)for(let y=0;y<=7;y++)for(let z=0;z<=4;z++)source.paint.set(`${x},${y},${z}`,[0,1,0,1]);
  const v=ClayVolume.fromState({shape:'full',field:[]});v.extrudeSource=source;
  v.extrusion=taperedStroke([[0,0,-.055],[.4,0,.2],[.8,0,.3]],.1,false);v.extrusion.color=[0,.7,1];
  assert.deepEqual(samplePaint(source,.06,0,.04),[0,1,0,1]);
  assert.deepEqual(samplePaint(v,.06,0,.04),[0,0,0,0],'old green skin cannot cover the new blue material');
  assert.ok(samplePaint(v,0,.12,.002)[3]>.99,'the original surface retains its paint');
  v.paint.set('3,0,2',[1,0,0,1]);assert.deepEqual(samplePaint(v,.06,0,.04),[1,0,0,1],'explicit paint applied afterward still works');
});

test('The attachment uses smooth source lighting with the same six distance queries and unchanged field',()=>{
  const source=ClayVolume.fromState({shape:'full',field:[]});let queries=0;
  source.sample=(x,y,z)=>{queries++;return z;};
  const v=ClayVolume.fromState({shape:'full',field:[]});v.extrudeSource=source;
  v.extrusion=taperedStroke([[0,0,-.055],[.4,0,.2],[.8,0,.3]],.1,false);
  const point=[.06,0,.015],before=v.sample(...point);queries=0;
  const normal=v.gradient(...point);
  assert.equal(queries,6,'smoother lighting must not add geometry samples');
  assert.ok(Math.abs(normal.length()-1)<1e-12);assert.ok(normal.z>.9,'near the mask the normal follows the original skin');
  assert.ok(normal.fieldNormal,'face orientation keeps the true field normal rather than the lighting normal');
  assert.equal(v.sample(...point),before,'shading never moves the surface');
  const tip=[.8,0,.3],h=.0125;
  const expected=new THREE.Vector3(v.sample(tip[0]+h,tip[1],tip[2])-v.sample(tip[0]-h,tip[1],tip[2]),v.sample(tip[0],tip[1]+h,tip[2])-v.sample(tip[0],tip[1]-h,tip[2]),v.sample(tip[0],tip[1],tip[2]+h)-v.sample(tip[0],tip[1],tip[2]-h)).normalize();
  assert.ok(v.gradient(...tip).distanceTo(expected)<1e-12,'the free extrusion keeps its own lighting');
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
  v.paint.set('1,1,1',[0,1,0,1]);
  const paintedGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([.02,.02,.02],3));
  applyVertexPaint(v,paintedGeometry);
  assert.equal(v.material.userData.surfacePaint.volume,v,'fixture includes the live circular paint state');
  const tool=new SurfaceExtrude(v,()=>{}),selected=new THREE.Color('#e87967');
  tool.begin(new THREE.Vector3(.7,.7,.4),.3,true,selected);
  selected.set('#0000ff');tool.update(new THREE.Vector3(1.5,1.2,1.1));
  const expected=new THREE.Color('#e87967').toArray();
  const preview=tool.preview.children[0].geometry.getAttribute('extrudeColor');
  assert.notEqual(tool.preview.children[0].material,v.material);
  assert.equal(tool.preview.children[0].material.userData.surfacePaint.volume,undefined,'the live tube must not inherit mask pigment');
  assert.ok(preview);assert.ok(Math.abs(preview.getX(0)-expected[0])<1e-6);
  tool.finish();assert.deepEqual(v.extrusion.color,expected);
  assert.ok(restoreHistory(v));assert.equal(extrusionTintSampler(v),null);
  assert.ok(restoreHistory(v,true));assert.deepEqual(v.extrusion.color,expected);
  tool.abort();paintedGeometry.dispose();v.material.dispose();
});

test('Pull anchor subdivision interpolates tint without losing vertex alignment',()=>{
  const brick={positions:new Float32Array([0,0,0,.1,0,0,0,.1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),tints:new Float32Array([1,0,0,1,0,1,0,1,0,0,1,1])};
  anchorVertex([brick],[.02,.02,0]);
  assert.equal(brick.tints.length/4,brick.positions.length/3);
  assert.ok(Math.abs(brick.tints[8]-.6)<1e-6);assert.ok(Math.abs(brick.tints[9]-.2)<1e-6);
  assert.ok(Math.abs(brick.tints[10]-.2)<1e-6);assert.equal(brick.tints[11],1);
});
