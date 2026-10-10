import test from 'node:test';
import assert from 'node:assert/strict';
import { HandSelection, ControlHand } from '../src/handSelection.js';

const point = {x:100,y:100};
function dwell(selection, target = 'cut', start = 0, extra = {}) {
  selection.update({point,target,now:start,...extra});
  selection.update({point,target,now:start+250,...extra});
  return selection.update({point,target,now:start+500,...extra});
}

test('Hover selects at 500 ms without a pinch and reports progress before activation',()=>{
  const s = new HandSelection();
  assert.equal(s.update({point,target:'cut',now:0}).progress,0);
  assert.equal(s.update({point,target:'cut',now:250}).progress,.5);
  assert.equal(s.update({point,target:'cut',now:499}).activated,undefined);
  assert.equal(s.update({point,target:'cut',now:500}).activated,'cut');
});

test('Continuing to hover cannot repeat selection; leaving and returning starts a fresh dwell',()=>{
  const s = new HandSelection();assert.equal(dwell(s).activated,'cut');
  assert.equal(s.update({point,target:'cut',now:1000}).activated,undefined);
  assert.equal(s.update({point,target:'cut',now:2000}).activated,undefined);
  s.update({point,target:null,now:2100});
  assert.equal(dwell(s,'cut',2200).activated,'cut');
});

test('Leaving the button, making a fist, or losing tracking cancels an unfinished countdown',()=>{
  for(const interruption of [{point,target:null},{point,target:'cut',fist:true},{point:null}]){
    const s = new HandSelection();s.update({point,target:'cut',now:0});s.update({point,target:'cut',now:250});
    assert.equal(s.update({...interruption,now:400}).activated,undefined);
    assert.equal(s.update({point,target:'cut',now:500}).progress,0);
    assert.equal(dwell(s,'cut',500).activated,'cut');
  }
});

test('Moving onto another button starts its own half-second countdown',()=>{
  const s = new HandSelection();s.update({point,target:'cut',now:0});s.update({point,target:'cut',now:250});
  assert.equal(s.update({point,target:'undo',now:400}).progress,0);
  s.update({point,target:'undo',now:650});
  assert.equal(s.update({point,target:'undo',now:899}).activated,undefined);
  assert.equal(s.update({point,target:'undo',now:900}).activated,'undo');
});

test('A long gap between tracking frames cannot complete an unattended dwell',()=>{
  const s = new HandSelection();s.update({point,target:'cut',now:0});s.update({point,target:'cut',now:250});
  assert.equal(s.update({point,target:'cut',now:750}).progress,0);
  assert.equal(dwell(s,'cut',750).activated,'cut');
});

test('Rebuilding a menu cannot toggle again or select a new button beneath a stationary finger',()=>{
  const s = new HandSelection(),bounds={left:60,right:140,top:60,bottom:140};
  assert.equal(dwell(s,{},0,{key:'symmetry',bounds}).phase,'selected');
  s.cancel();
  assert.equal(dwell(s,{},1000,{key:'symmetry',bounds}).activated,undefined);
  assert.equal(dwell(s,{},2000,{key:'confirm',bounds}).activated,undefined);
  s.update({point:{x:200,y:100},target:null,now:2600});
  assert.equal(dwell(s,'confirm',2700,{bounds}).activated,'confirm');
});

test('An existing canvas gesture wins over every toolbar target until it ends',()=>{
  const s = new HandSelection();
  const r=dwell(s,'cut',0,{blocked:true});assert.equal(r.owns,false);assert.equal(r.activated,undefined);
  assert.equal(s.update({point,target:'cut',now:550}).progress,0);
  assert.equal(dwell(s,'cut',550).activated,'cut');
});

test('An open panel owns input in gaps and a button owns input throughout its countdown',()=>{
  const s = new HandSelection();
  assert.equal(s.update({point,target:null,modal:true,now:0}).owns,true);
  const r=s.update({point,target:'cut',now:100});
  assert.equal(r.owns,true);assert.equal(r.activated,undefined);
});

test('Control hand survives detector reordering and briefly reserves a missing hand',()=>{
  const identity=new ControlHand();
  const left={index:0,label:'Left',palm:{x:.25,y:.5}},right={index:1,label:'Right',palm:{x:.75,y:.5}};
  assert.equal(identity.choose([left,right],0).label,'Left');
  assert.equal(identity.choose([right,left],50).label,'Left');
  assert.equal(identity.choose([right],150),null);
  assert.equal(identity.choose([right],400).label,'Right');
});

test('The same labelled hand can cross the stage without waiting for a hand switch',()=>{
  const identity=new ControlHand();
  identity.choose([{index:0,label:'Left',palm:{x:.15,y:.5}}],0);
  const hand=identity.choose([{index:0,label:'Left',palm:{x:.8,y:.5}}],50);
  assert.equal(hand.label,'Left');assert.equal(hand.changed,false);
});
