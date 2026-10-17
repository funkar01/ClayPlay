import test from 'node:test';
import assert from 'node:assert/strict';
import { extrusionDistance, taperedStroke, blendExtrusion } from '../src/extrudeGeometry.js';
import { referenceExtrusionDistance } from './helpers/extrusionReference.mjs';

test('Indexed extrusion matches exhaustive sampling for dense curves and mirrored strokes', () => {
  let seed = 17421;
  const random = () => ((seed = Math.imul(seed,1664525) + 1013904223 >>> 0) / 4294967296);
  for (const symmetry of [false, true]) {
    const points = Array.from({length:193}, (_,i) => {
      const t = i/192;
      return [.4 + Math.sin(t*9)*.5, t*1.5, .6 + Math.cos(t*7)*.3];
    });
    // Include a zero-length segment and preserve the flush starting plane.
    points.splice(1,0,[...points[0]]);
    const stroke = taperedStroke(points,.16,symmetry,false);
    for(let i=0;i<2500;i++) {
      const p = i<points.length ? points[i] : [random()*2-1,random()*2-.2,random()*1.5];
      for(const ceiling of [Infinity, -.12, .03, .35]) {
        const actual=extrusionDistance(...p,stroke,ceiling);
        const expected=referenceExtrusionDistance(...p,stroke,ceiling);
        assert.ok(Math.abs(actual-expected)<1e-10, `${p}: ${actual} vs ${expected}`);
      }
    }
  }
});

test('Repeated extrusions preserve blended values after serialization', () => {
  const strokes=Array.from({length:24},(_,j)=>taperedStroke(Array.from({length:81},(_,i)=>{
    const t=i/80;return [.6+t, .5+Math.sin(t*5+j*.2)*.4, .6+t*.4];
  }),.14,true,false));
  const restored=structuredClone(strokes);
  for(let i=0;i<600;i++) {
    const p=[.4+(i%20)*.05,.2+(Math.floor(i/20)%10)*.05,.6+Math.floor(i/200)*.08];
    let expected=.15,actual=.15;
    for(let j=0;j<strokes.length;j++) {
      expected=blendExtrusion(expected,referenceExtrusionDistance(...p,strokes[j],expected+.035),.14);
      actual=blendExtrusion(actual,extrusionDistance(...p,restored[j],actual+.035),.14);
    }
    assert.ok(Math.abs(actual-expected)<1e-10);
  }
});
