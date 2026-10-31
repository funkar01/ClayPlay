import test from 'node:test';
import assert from 'node:assert/strict';
import { ClayVolume } from '../src/clayVolume.js';
import { makeWarp } from '../src/maskWarp.js';
import { cacheVolumeNodes } from '../src/cacheVolumeNodes.js';

test('Nested source caches reuse grid samples while preserving overlay edits',()=>{
  let volume=ClayVolume.fromState({shape:'full',field:[]});const leaf=volume;let calls=0;
  const original=leaf.baseDistance.bind(leaf);leaf.baseDistance=(...p)=>{calls++;return original(...p);};
  for(let i=0;i<4;i++) {const source=volume;volume=ClayVolume.fromState({shape:'full',field:[]});volume.pullSource=source;volume.pullWarp=makeWarp([-.6,.8,.4],[-.04,.05,.01],.336,.55);}
  const points=[[70,128,112],[71,128,112],[70,129,112]];
  const expected=points.map(p=>volume.nodeValue(...p));calls=0;
  cacheVolumeNodes(volume);assert.deepEqual(points.map(p=>volume.nodeValue(...p)),expected);
  assert.ok(calls<200,'overlapping samples must reuse the deepest source nodes');
  const before=calls;assert.deepEqual(points.map(p=>volume.nodeValue(...p)),expected);assert.equal(calls,before);
  const key=volume.nodeKey(...points[0]);volume.field.set(key,1);assert.equal(volume.nodeValue(...points[0]),1);
  volume.field.delete(key);assert.equal(volume.nodeValue(...points[0]),expected[0]);
});

test('Later extrusion layers reuse source grid samples without wrapping caches again',()=>{
  const source=ClayVolume.fromState({shape:'full',field:[]});let samples=0;
  const original=source.baseDistance.bind(source);source.baseDistance=(...p)=>{samples++;return original(...p);};
  cacheVolumeNodes(source);const cachedSample=source.sample;
  const point=[-2.4+100*.025,-2.4+110*.025,-2.4+120*.025];
  const expected=source.sample(...point);const before=samples;
  for(let i=0;i<30;i++)assert.equal(source.sample(...point),expected);
  assert.equal(samples,before);cacheVolumeNodes(source);assert.equal(source.sample,cachedSample);
  assert.equal(source.sample(.51343,.38798,.41234),original(.51343,.38798,.41234),'off-grid evaluation must not be rounded');
});
