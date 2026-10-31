import test from 'node:test';
import assert from 'node:assert/strict';
import { ClayVolume } from '../src/clayVolume.js';
import { samplePaint } from '../src/paintLayer.js';
import { createPaintSampler } from '../src/paintSampling.js';
import { taperedStroke } from '../src/extrudeGeometry.js';
import { makeWarp } from '../src/maskWarp.js';
import { fillPaintTexture } from '../src/paintTextureData.js';

function editedVolume() {
  let v=ClayVolume.fromState({shape:'full',field:[],paint:[['8,8,8',[.8,.2,.1,1]],['9,8,8',[0,.3,.8,.6]]],paintCell:.05});
  for(let i=0;i<4;i++) {
    const next=ClayVolume.fromState({shape:'full',field:[]});
    next.extrudeSource=v;next.extrusion=taperedStroke([[.4,.4,.4],[.8,.7,1],[1.1,.8,1.2]],.1,true);
    v=next;
  }
  const pulled=ClayVolume.fromState({shape:'full',field:[],paint:[['25,25,25',[.1,.7,.2,1]],['26,25,25',[0,0,0,0]]]});
  pulled.pullSource=v;pulled.pullWarp=makeWarp([.4,.4,.4],[.15,.1,.02],.3,.55,true);
  const cut=ClayVolume.fromState({shape:'full',field:[],paint:[['-10,0,0',[.2,.2,.8,.7]]]});cut.cutSource=pulled;
  return cut;
}

test('Compiled pigment sampling matches legacy pixels through paint, extrusion, Pull and Cut layers',()=>{
  const volume=editedVolume(),sample=createPaintSampler(volume);
  const plan={min:[-.8,-.5,-.1],size:[64,56,40],spacing:.025},length=plan.size.reduce((a,b)=>a*b,1)*4;
  const before=fillPaintTexture(new Uint8Array(length),plan,(...p)=>samplePaint(volume,...p));
  const after=fillPaintTexture(new Uint8Array(length),plan,sample);
  assert.deepEqual(after,before);
  for(const point of [[.4,.4,.4],[.45,.4,.4],[.55,.5,.42],[.5,.5,.5],[-.2,0,0],[4,4,4]]) {
    const expected=samplePaint(volume,...point),actual=sample(...point);
    for(let a=0;a<4;a++)assert.ok(Math.abs(expected[a]-actual[a])<1e-12);
  }
});

test('Empty texels avoid all source geometry calculations in a deep extrusion history',()=>{
  let volume=ClayVolume.fromState({shape:'full',field:[],paint:[['25,25,25',[1,0,0,1]]]});
  for(let i=0;i<8;i++) {
    const source=volume;volume=ClayVolume.fromState({shape:'full',field:[]});
    volume.extrudeSource=source;volume.extrusion=taperedStroke([[.7,.7,.4],[1.1,1,1]],.1);
    source.sample=()=>assert.fail('empty pixels must not walk the geometry history');
  }
  const sample=createPaintSampler(volume);
  for(let i=0;i<1000;i++)assert.deepEqual(sample(-1+i*.0001,-1,.1),[0,0,0,0]);
});

test('Geometry-only serialization retains edited fields and tint while leaving saved paint untouched',()=>{
  const volume=editedVolume(),full=volume.serialize(),geometry=volume.serialize({includePaint:false});
  const walk=(state,other)=>{
    assert.deepEqual(other.paint,[]);assert.deepEqual(state.field,other.field);
    assert.deepEqual(state.extrusion,other.extrusion);
    for(const key of ['pullSource','extrudeSource','cutSource'])if(state[key])walk(state[key],other[key]);
  };
  walk(full,geometry);assert.deepEqual(volume.serialize(),full,'normal save/load still retains every pigment');
});
