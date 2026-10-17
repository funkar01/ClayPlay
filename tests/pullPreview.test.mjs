import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PullPreview } from '../src/pullPreview.js';
import { makeWarp } from '../src/maskWarp.js';

test('GPU preview advances between measured results without overshoot and freezes precisely on release', () => {
  const material = new THREE.MeshPhysicalMaterial(), preview = new PullPreview(material);
  preview.begin(makeWarp([.8,.6,.3], [0,0,0], .336));
  const target = makeWarp([.8,.6,.3], [.4,.2,0], .336, .55, true);
  preview.update(target);
  let previous = 0;
  for (const now of [0, 8, 16, 24, 32]) {
    preview.tick(now);
    const x = preview.uniforms.pullDelta.value.x;
    assert.ok(x > previous && x < .4); previous = x;
  }
  preview.freeze(target); preview.tick(64);
  assert.deepEqual(preview.uniforms.pullDelta.value.toArray(), target.delta);
  assert.equal(preview.uniforms.pullSteps.value, target.steps.length);
  preview.clear(); assert.equal(preview.uniforms.pullEnabled.value, 0);
  material.dispose();
});

test('Separate masks have separate preview uniforms and retain existing material hooks', () => {
  const a = new THREE.MeshPhysicalMaterial(), b = a.clone(); let called = false;
  a.onBeforeCompile = shader => { called = true; shader.uniforms.existing = {value:1}; };
  const first = new PullPreview(a), second = new PullPreview(b);
  const shader = {uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>'};
  a.onBeforeCompile(shader);
  assert.equal(called,true); assert.equal(shader.uniforms.existing.value,1);
  assert.equal(shader.uniforms.pullDelta,first.uniforms.pullDelta);
  assert.notEqual(first.uniforms.pullDelta,second.uniforms.pullDelta);
  assert.ok(shader.vertexShader.includes('pullVertex(pullPosition, objectNormal)'));
  a.dispose(); b.dispose();
});
