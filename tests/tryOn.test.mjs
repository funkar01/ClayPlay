import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { faceMaskPose, MaskTryOn } from '../src/tryOn.js';
import { cameraCoverPoint } from '../src/arView.js';
import { trackingOptions } from '../src/trackingOptions.js';

function face(rotation = new THREE.Euler(), x = 0.5, y = 0.45, size = 0.2) {
  const q = new THREE.Quaternion().setFromEuler(rotation), points = Array(478);
  for (const [a, b, sign] of [[33, 133, -1], [263, 362, 1]]) {
    const p = new THREE.Vector3(sign * size / 2, 0, 0).applyQuaternion(q);
    points[a] = points[b] = { x: x + p.x, y: y - p.y, z: -p.z };
  }
  return { faceLandmarks: [points], facialTransformationMatrixes: [{ data: new THREE.Matrix4().makeRotationFromQuaternion(q).elements }] };
}

test('Try-on eye openings align with the mirrored video across crops and head rotations', () => {
  for (const [sw, sh, vw, vh] of [[1280,720,686,558],[1280,720,1600,1100],[720,1280,320,580]]) {
    for (const rotation of [new THREE.Euler(), new THREE.Euler(0.15,0.45,-0.12), new THREE.Euler(-0.25,-0.6,0.2)]) {
      const result = face(rotation), pose = faceMaskPose(result, sw, sh, vw, vh);
      assert.ok(pose);
      for (const [index, x] of [[263,-0.46],[33,0.46]]) {
        const actual = new THREE.Vector3(x,0.35,0.43).applyQuaternion(pose.quaternion).multiplyScalar(pose.scale).add(pose.position);
        const expected = cameraCoverPoint(result.faceLandmarks[0][index], sw, sh, vw, vh);
        assert.ok(Math.abs((actual.x / (vw / vh) + 1) / 2 - expected.x) < 1e-9);
        assert.ok(Math.abs((1 - actual.y) / 2 - expected.y) < 1e-9);
      }
      const originalAxis = new THREE.Vector3(1,0,0).applyEuler(rotation);
      const wornAxis = new THREE.Vector3(1,0,0).applyQuaternion(pose.quaternion);
      assert.ok(Math.abs(originalAxis.z + wornAxis.z) < 1e-9, 'Yaw follows the mirrored head');
    }
  }
});

test('Try-on rejects missing or malformed faces and scales with camera distance', () => {
  assert.equal(faceMaskPose({ faceLandmarks: [] },1280,720,686,558), null);
  const tiny = face(new THREE.Euler(),0.5,0.45,0.0001);
  assert.equal(faceMaskPose(tiny,1280,720,686,558), null);
  const bad = face(); bad.faceLandmarks[0][33].x = NaN;
  assert.equal(faceMaskPose(bad,1280,720,686,558), null);
  const a = faceMaskPose(face(new THREE.Euler(),0.5,0.45,0.1),1280,720,686,558);
  const b = faceMaskPose(face(new THREE.Euler(),0.5,0.45,0.2),1280,720,686,558);
  assert.ok(Math.abs(b.scale / a.scale - 2) < 1e-9);
});

test('Wearing shares edited geometry, smooths movement, hides on loss, and leaves every mask unchanged', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const group = new THREE.Group(), mesh = new THREE.Mesh(geometry, material); group.add(mesh);
  group.position.set(1,2,3); group.scale.setScalar(0.4); group.updateMatrix();
  const item = { group, volume: { bricks: new Map([['a',{mesh}]]) } };
  const before = group.matrix.clone();
  const view = new MaskTryOn([new THREE.HemisphereLight()]); view.resize(686,558);
  view.setEnabled(true); view.setItem(item);
  assert.equal(view.mask.children[0].geometry, geometry); assert.equal(view.mask.children[0].material, material);
  view.receive(face(),100,1280,720); assert.equal(view.update(100,0.016), true);
  const start = view.mask.position.x;
  view.receive(face(new THREE.Euler(),0.6),120,1280,720); view.update(120,0.016);
  assert.ok(view.mask.position.x < start && view.mask.position.x > view.target.position.x);
  view.receive({faceLandmarks:[]},140,1280,720);
  assert.equal(view.update(200,0.016),true); assert.equal(view.update(421,0.016),false);
  view.receive(face(),450,1280,720); assert.equal(view.update(450,0.016),true);
  group.updateMatrix(); assert.deepEqual(group.matrix.elements,before.elements);
  view.setEnabled(false); assert.equal(view.mask.children.length,0); assert.equal(view.mask.visible,false);
  assert.ok(geometry.attributes.position.array.length > 0); assert.equal(mesh.parent,group);
});

test('Face tracking loads only its model and skips expression inference; hand options remain unchanged', () => {
  const face = trackingOptions('face'), hand = trackingOptions('hand');
  assert.match(face.baseOptions.modelAssetPath,/face_landmarker/);
  assert.equal(face.numFaces,1); assert.equal(face.outputFacialTransformationMatrixes,true);
  assert.equal(face.outputFaceBlendshapes,false); assert.equal(face.numHands,undefined);
  assert.equal(face.baseOptions.delegate,'CPU');
  assert.match(hand.baseOptions.modelAssetPath,/hand_landmarker/);
  assert.equal(hand.numHands,1); assert.equal(hand.minHandDetectionConfidence,0.52);
  assert.equal(hand.minTrackingConfidence,0.48); assert.equal(hand.numFaces,undefined);
  assert.equal(hand.baseOptions.delegate,'GPU');
});
