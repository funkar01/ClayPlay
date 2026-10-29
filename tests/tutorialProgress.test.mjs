import test from 'node:test';
import assert from 'node:assert/strict';
import {tutorialApplying,TutorialStepGate} from '../src/tutorialProgress.js';

const actions=[
  [{tool:'pinch',id:'curve',target:[.6,0,.5]},'pinch',{center:[.6,0,.5],delta:[.2,0,0]}],
  [{tool:'extrude',target:[.6,0,.5]},'extrude',{points:[[.6,0,.5],[.8,.2,.5]]}],
  [{tool:'paint',target:[.6,0,.5]},'paint',{point:[.6,0,.5]}],
  [{tool:'erase',target:[.6,0,.5]},'erase',{changed:true}],
];

for(const [mission,tool,data] of actions)test(`${tool} completes once, after release, geometry, cleanup, and paint all finish`,()=>{
  const gate=new TutorialStepGate(),paint={dirty:false,queue:{}},volume={material:{userData:{surfacePaint:paint}},meshQueue:{},surfaceExtrude:{queue:[]}};
  assert.equal(gate.record(mission,tool,data),true);
  assert.equal(gate.record(mission,tool,data),false,'duplicate callbacks cannot queue another lesson');
  assert.equal(gate.update({busy:false,held:true}),false,'a held gesture cannot advance');
  for(const stage of ['pulling','cutting','erasing']) {
    volume[stage]=true;assert.equal(gate.update({busy:tutorialApplying(volume),held:false}),false);volume[stage]=false;
  }
  for(const stage of ['pending','refining']) {
    volume.meshQueue[stage]=true;assert.equal(gate.update({busy:tutorialApplying(volume),held:false}),false);volume.meshQueue[stage]=false;
  }
  volume.surfaceExtrude.committing=true;assert.equal(gate.update({busy:tutorialApplying(volume)}),false);volume.surfaceExtrude.committing=false;
  volume.surfaceExtrude.queue.push({});assert.equal(gate.update({busy:tutorialApplying(volume)}),false);volume.surfaceExtrude.queue=[];
  paint.dirty=true;assert.equal(gate.update({busy:tutorialApplying(volume)}),false);paint.dirty=false;
  paint.queue.active={};assert.equal(gate.update({busy:tutorialApplying(volume)}),false);paint.queue.active=null;
  paint.completed={};assert.equal(gate.update({busy:tutorialApplying(volume)}),false);paint.completed=null;
  assert.equal(gate.update({busy:tutorialApplying(volume)}),false,'the completed surface gets a render turn');
  assert.equal(gate.update({busy:tutorialApplying(volume)}),true);
  assert.equal(gate.update({busy:false}),false,'completion fires once');
});

test('A brief idle gap cannot advance while another update is being queued',()=>{
  const gate=new TutorialStepGate();gate.record(...actions[1]);
  assert.equal(gate.update({busy:false}),false);
  assert.equal(gate.update({busy:true}),false);
  assert.equal(gate.update({busy:false}),false);
  assert.equal(gate.update({busy:false}),true);
});

test('Invalid actions and cancelled tutorials do not leave a completion to replay',()=>{
  const gate=new TutorialStepGate();assert.equal(gate.record(actions[0][0],'paint',actions[0][2]),false);
  assert.equal(gate.update({busy:false}),false);
  gate.record(...actions[0]);gate.reset();
  assert.equal(gate.update({busy:false}),false);assert.equal(gate.update({busy:false}),false);
});

test('An inactive failed or superseded paint build cannot leave the tutorial waiting forever',()=>{
  const volume={material:{userData:{surfacePaint:{pendingBuild:true,dirty:false,queue:{active:null,pending:null}}}}};
  assert.equal(tutorialApplying(volume),false);
  volume.material.userData.surfacePaint.queue.pending={};assert.equal(tutorialApplying(volume),true);
});
