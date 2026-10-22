import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackingTrace } from '../src/trackingTrace.js';
import { PalmControl, palmPosture } from '../src/palmControl.js';
import { palmHand } from './helpers/palmHand.mjs';

test('Trace preserves the initiating failure before later resets and bounds recent history',()=>{
  let now=0;const trace=new TrackingTrace(3,()=>now);
  trace.record('frame',{hands:1});now=50;trace.incident('palm-too-edge-on',{held:true});
  const first=trace.report().failure;
  now=60;trace.incident('ui-input-capture');now=90;trace.record('reset');
  assert.equal(trace.report().failure.reason,'palm-too-edge-on');
  assert.equal(trace.report().recent.length,3);
  assert.equal(first.before[0].event,'frame');
  for(let i=0;i<8;i++)trace.record('next-frame');
  assert.equal(first.before[0].event,'frame','the pre-failure evidence survives buffer rollover');
  now=2000;trace.incident('tracking-result-over-500ms');
  assert.equal(trace.report().failure.reason,'tracking-result-over-500ms');
});

test('Palm diagnostics distinguish edge-on geometry, frame gaps, jumps and ambiguous fingers',()=>{
  const ready=()=>{const c=new PalmControl();c.update(palmHand(),0);c.update(palmHand(),100);c.update(palmHand(true),130);c.update(palmHand(true),240);return c;};
  const c=ready();
  c.update(palmHand(true),510);assert.equal(c.diagnostic.reason,'palm-frame-gap');
  assert.equal(c.diagnostic.gapMs,270);assert.equal(c.diagnostic.heldBefore,true);
  const edge=palmHand(true);edge[5]={x:.45,y:.5,z:0};edge[17]={x:.55,y:.8,z:0};
  let reason;assert.equal(palmPosture(edge,1,r=>{reason=r;}),null);assert.equal(reason,'palm-too-edge-on');
  const a=ready();const mixed=palmHand(true);for(const i of [8,12])mixed[i].y=.38;
  assert.equal(a.update(mixed,270).phase,'uncertain');assert.equal(a.diagnostic.reason,'ambiguous-palm-posture');
  const b=ready();assert.equal(b.update(palmHand(true,.38),270).phase,'lost');assert.equal(b.diagnostic.reason,'palm-position-jump');
});
