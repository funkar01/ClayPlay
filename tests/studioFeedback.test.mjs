import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingPresentation} from '../src/studioFeedback.js';
test('Tracking feedback distinguishes cursor, hand loss, grip and paused modes',()=>{
 assert.equal(trackingPresentation().label,'Cursor mode · ready');
 assert.equal(trackingPresentation({cameraOn:true}).state,'searching');
 assert.equal(trackingPresentation({cameraOn:true,tracked:false,held:true}).state,'searching','lost tracking must never claim a grip');
 assert.equal(trackingPresentation({cameraOn:true,tracked:true,held:true}).state,'held');
 assert.equal(trackingPresentation({cameraOn:true,tracked:true,held:true,palm:false}).label,'Shaping · release your pinch');
 assert.equal(trackingPresentation({paused:true,held:true}).state,'paused');
 assert.equal(trackingPresentation({trying:true}).label,'Try-on mode');
});

test('Applying stays visible without a tracked hand and clears to ready when work finishes', async () => {
 const {studioMessagePresentation}=await import('../src/studioFeedback.js');
 const state={applying:true,waiting:true,cameraOn:true,tracked:false,commit:'Shape kept',menuHint:'Point to choose'};
 assert.equal(studioMessagePresentation(state).state,'applying');
 assert.match(studioMessagePresentation(state).label,/please wait/);
 assert.equal(studioMessagePresentation({...state,waiting:false}).label,'Applying your changes…');
 assert.equal(studioMessagePresentation({...state,trying:true}).state,'neutral');
 assert.equal(studioMessagePresentation({applying:true,hint:'Erase could not finish'}).state,'paused');
 assert.equal(studioMessagePresentation({applying:false}).state,'ready');
});

test('The unified message prioritizes tracking loss, current controls and processing over routine hints',async()=>{
 const {studioMessagePresentation}=await import('../src/studioFeedback.js');
 assert.equal(studioMessagePresentation({cameraOn:true,tracked:true,hint:'Move your palm to aim · close gently to apply'}).label,'Move your palm to aim · close gently to apply');
 assert.equal(studioMessagePresentation({cameraOn:true,tracked:false,hint:'Move your palm',commit:'Shape kept'}).state,'searching');
 assert.equal(studioMessagePresentation({menuHint:'Hold until the ring fills',hint:'Move your palm'}).label,'Hold until the ring fills');
 assert.equal(studioMessagePresentation({processing:'Keeping your change',commit:'Shape kept'}).label,'Keeping your change');
 assert.equal(studioMessagePresentation({commit:'Paint applied',hint:'Move your palm'}).label,'Paint applied');
 assert.equal(studioMessagePresentation({hint:'Erase could not finish',commit:'Shape kept'}).state,'paused');
});
