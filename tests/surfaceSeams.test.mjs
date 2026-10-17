import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { makeWarp } from '../src/maskWarp.js';
import { surfaceBrickKeys } from '../src/surfaceBricks.js';

function boundary(volume,bx,step=1) {
  volume.meshStep=step;volume.rebuildBrick(bx,5,4);
  const p=volume.bricks.get(`${bx},5,4`)?.mesh.geometry.attributes.position.array ?? [];
  const edges=new Set();
  const point=i=>[p[i],p[i+1],p[i+2]].map(v=>Math.round(v*1e6)).join(',');
  for(let i=0;i<p.length;i+=9) for(const [a,b]of [[0,3],[3,6],[6,0]]) {
    if(Math.abs(p[i+a]+.6)>1e-6 || Math.abs(p[i+b]+.6)>1e-6)continue;
    const ends=[point(i+a),point(i+b)].sort();if(ends[0]!==ends[1])edges.add(ends.join('|'));
  }
  return [...edges].sort();
}

test('Eyebrow brick edges remain identical after repeated mirrored and one-sided pulls',()=>{
  const volume=ClayVolume.fromState({shape:'full',field:[]});
  Object.assign(volume,{parent:new THREE.Group(),material:null,bricks:new Map()});
  for(let stroke=0;stroke<3;stroke++) {
    if(stroke) {
      volume.pullSource=volume.snapshot();volume.field=new Map();
      volume.pullWarp=makeWarp([-.6,.8,.4],[-.12,.12,.04],.336,.55,stroke===2);
    }
    const left=boundary(volume,2),right=boundary(volume,3);
    assert.ok(left.length>0,'test must intersect the actual eyebrow surface');
    assert.deepEqual(left,right,`shared edge after ${stroke} pulls`);
    if(stroke===0)assert.notDeepEqual(left,boundary(volume,3,2),'regression fixture must detect the old coarse/fine crack');
  }
  for(const {mesh}of volume.bricks.values())mesh.geometry.dispose();
});

test('Remeshing covers triangles crossing brick boundaries, not only their centroids',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.8,.7,.3,.8,.7,.3,0,.9,.4],3));
  const bricks=new Map([['4,5,4',{mesh:new THREE.Mesh(geometry)}]]);
  const keys=surfaceBrickKeys(bricks);
  assert.ok(keys.has('2,5,4'));assert.ok(keys.has('5,5,4'));
  assert.ok(keys.has('4,5,4'),'old ownership must also be cleared');geometry.dispose();
});
