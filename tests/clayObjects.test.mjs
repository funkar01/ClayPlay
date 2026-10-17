import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClayObjects } from '../src/clayObjects.js';

test('Only the latest selected mask is visible and each selection occupies the same stage position', () => {
  const objects=Object.create(ClayObjects.prototype);
  objects.items=[1,2,3].map(id=>({id,group:new THREE.Group(),volume:{}}));
  objects.active=objects.items[0];
  objects.marker=new THREE.Object3D();
  const camera=new THREE.PerspectiveCamera(40,1.6,.1,100);camera.position.z=8.6;
  objects.layout(camera);
  for(const id of [1,3,2,1]) {
    objects.select(id);
    assert.deepEqual(objects.items.filter(item=>item.group.visible).map(item=>item.id),[id]);
    assert.deepEqual(objects.active.group.position.toArray(),[0,-.08,0]);
    assert.equal(objects.marker.visible,false);
  }
  objects.active.volume.userOffset=[.2,.1];objects.active.volume.userScale=1.2;
  objects.layout(camera);
  assert.deepEqual(objects.active.group.position.toArray(),[.2,.1-.08,0]);
  assert.equal(objects.active.group.scale.x,1.2);
  assert.equal(objects.items.length,3,'previous masks remain available to select');
});
