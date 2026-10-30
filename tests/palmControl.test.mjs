import test from 'node:test';
import assert from 'node:assert/strict';
import {PalmControl,palmPosture} from '../src/palmControl.js';
import {palmHand} from './helpers/palmHand.mjs';

function ready(c) {c.update(palmHand(),0);return c.update(palmHand(),100);}

test('Fresh results at 270 ms intervals can arm and start a deliberate extrusion grip',()=>{
  const c=new PalmControl();
  for(const t of [0,270,540])c.update(palmHand(),t);
  assert.equal(c.update(palmHand(true),810).held,false);
  assert.equal(c.update(palmHand(true),1080).held,true,'valid slower inference must not reset arming on every result');
  assert.equal(c.update(palmHand(),1350).held,false);
});

test('Palm control requires an open hand before a deliberate closure; opening releases on that frame',()=>{
  const c=new PalmControl();
  for(const t of [0,100,200])assert.equal(c.update(palmHand(true),t).held,false);
  c.update(palmHand(),250);assert.equal(c.update(palmHand(),350).phase,'ready');
  assert.equal(c.update(palmHand(true),400).held,false);
  assert.equal(c.update(palmHand(true),480).held,false);
  assert.equal(c.update(palmHand(true),510).held,true);
  assert.equal(c.update(palmHand(),530).held,false);
});

test('Closure preserves cursor position, then palm movement drives a continuous grip',()=>{
  const c=new PalmControl();const open=ready(c);
  c.update(palmHand(true,.012),130);
  const grip=c.update(palmHand(true,.012),240);
  assert.equal(grip.held,true);assert.deepEqual(grip.point,open.point);
  const moved=c.update(palmHand(true,.05),280);
  assert.ok(moved.point.x>grip.point.x);assert.equal(moved.held,true);
  assert.equal(c.update(palmHand(false,.05),310).held,false);
});

test('Finger identity and image-plane rotation do not change the anatomical palm anchor',()=>{
  const open=palmHand(),closed=palmHand(true);
  assert.deepEqual(palmPosture(open).center,palmPosture(closed).center);
  [closed[8],closed[12]]=[closed[12],closed[8]];
  assert.equal(palmPosture(closed).closed,true);
  for(const angle of [-1,-.5,.5,1]) {
    const rotated=open.map(p=>({x:.5+(p.x-.5)*Math.cos(angle)-(p.y-.5)*Math.sin(angle),y:.5+(p.x-.5)*Math.sin(angle)+(p.y-.5)*Math.cos(angle),z:0}));
    assert.equal(palmPosture(rotated).open,true);
  }
});

test('Loss, camera clipping and implausible jumps disarm edits until another open hand',()=>{
  for(const bad of [[],palmHand(true,.48),palmHand(true,.38)]) {
    const c=new PalmControl();ready(c);c.update(palmHand(true),130);assert.equal(c.update(palmHand(true),240).held,true);
    assert.equal(c.update(bad,270).held,false);
    assert.equal(c.update(palmHand(true),300).held,false);
    assert.equal(c.update(palmHand(true),410).held,false);
  }
});

test('Unknown transition is not an activation; stale input cannot reconnect a held stroke',()=>{
  const c=new PalmControl();ready(c);
  const uncertain=palmHand();uncertain[8].y=.56;uncertain[12].y=.56;
  assert.equal(c.update(uncertain,130).held,false);
  c.update(palmHand(true),170);assert.equal(c.update(palmHand(true),280).held,true);
  assert.equal(c.update(palmHand(true),600).held,false);
});
