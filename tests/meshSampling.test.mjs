import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayVolume } from '../src/clayVolume.js';
import { taperedStroke } from '../src/extrudeGeometry.js';

test('Meshing reuses grid samples and edge normals without changing surface gradients', () => {
  const v=ClayVolume.fromState({shape:'full',field:[]});
  v.extrudeSource=v.snapshot();
  v.extrusion=taperedStroke([[.6,.5,.6],[1,.5,.9],[1.5,.6,1.1]],.14,true);
  Object.assign(v,{parent:new THREE.Group(),material:null,bricks:new Map()});
  let nodes=0,gradients=0;
  const sample=v.nodeValue.bind(v),gradient=v.gradient.bind(v);
  v.nodeValue=(...p)=>{nodes++;return sample(...p);};
  v.gradient=(...p)=>{gradients++;return gradient(...p);};
  v.rebuildBrick(5,4,5);
  const geometry=v.bricks.get('5,4,5').mesh.geometry;
  try {
    const positions=geometry.attributes.position,normals=geometry.attributes.normal;
    assert.equal(nodes,25**3,'each grid node is evaluated once per brick');
    assert.ok(gradients<positions.count/3,'shared edges reuse gradients across triangles');
    for(let i=0;i<positions.count;i+=37) {
      const p=new THREE.Vector3().fromBufferAttribute(positions,i);
      const expected=gradient(p.x,p.y,p.z);
      const actual=new THREE.Vector3().fromBufferAttribute(normals,i);
      assert.ok(actual.distanceTo(expected)<1e-4,'normals retain the analytic field gradient');
    }
    // The cache is local to a build, so later edits must not reuse stale values.
    v.extrusion=taperedStroke([[.6,.5,.6],[1,.5,.9],[1.5,.6,1.1]],.06,true);
    nodes=0;v.rebuildBrick(5,4,5);
    assert.equal(nodes,25**3);
    assert.notEqual(v.bricks.get('5,4,5').mesh.geometry.attributes.position.count,positions.count);
  } finally {for(const {mesh}of v.bricks.values())mesh.geometry.dispose();}
});
