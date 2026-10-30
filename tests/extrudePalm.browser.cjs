// Camera-free browser replay using real gesture, cursor, raycast and extrusion paths.
const assert=require('node:assert/strict');
module.exports=async page=>{
  await page.goto(process.argv[3] || process.env.CLAYPLAY_TEST_URL || 'http://127.0.0.1:5175/?diagnostics');
  await page.waitForFunction(()=>window.clayPlayDebug && !window.clayPlayDebug.getState().pending);
  await page.locator('.comfort-skip').click();
  await page.locator('#tutorial-skip').click();
  await page.locator('#mask-picker-continue').click();
  await page.evaluate(()=>{
    const d=window.clayPlayDebug;d.objects.active.volume.reset('full');d.setControlMode('palm');
  });
  await page.waitForFunction(()=>!window.clayPlayDebug.getState().pending);
  await page.locator('#tool-extrude').click({force:true});
  const offset=await page.evaluate(()=>{
    const d=window.clayPlayDebug,group=d.objects.active.volume.parent;
    const position=group.localToWorld(d.camera.position.clone().set(0,-.45,.65)).project(d.camera);
    const canvas=document.querySelector('#three-scene canvas').getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();
    const x=canvas.left+(position.x+1)*canvas.width/2,y=canvas.top+(1-position.y)*canvas.height/2;
    return {dx:.15+.7*(1-(x-stage.left)/stage.width)-.508,dy:.15+.7*(y-stage.top)/stage.height-.53};
  });
  // Replay measurement timestamps deterministically. Software GPU rendering
  // in headless Edge must not turn a 270ms test cadence into a >300ms dropout.
  const states=await page.evaluate(async offset=>{
    const {palmHand}=await import('/tests/helpers/palmHand.mjs');
    const d=window.clayPlayDebug,start=performance.now();
    return [[false,0],[false,0],[true,0],[true,0],[true,.03],[true,.06],[false,.06]].map(([closed,move],i)=>{
      const now=start+i*270;
      d.feedHands([palmHand(closed,offset.dx-move,offset.dy-move)],now,{sampleAt:now-250});
      const v=d.objects.active.volume;
      return {...d.getState(),extrudeActive:Boolean(v.surfaceExtrude?.active),previewPoints:v.surfaceExtrude?.points?.length??0,cursorGesture:document.querySelector('.hand-ui-cursor').dataset.gesture};
    });
  },offset);
  const ready=states[1],held=states[3],moved=states[5],released=states[6];
  console.log(JSON.stringify({phases:states.map(s=>s.palmPhase),extrudeStates:states.map(s=>s.extrude)}));
  assert.equal(ready.palmPhase,'ready');
  assert.equal(held.held,true,'fresh 270ms results can close the hand');
  assert.equal(held.cursorGesture,'held','cursor and sculpting agree');
  assert.equal(held.extrudeActive,true,'the grip must attach to a real mask surface');
  assert.ok(moved.previewPoints>1);
  assert.equal(released.extrudeActive,false);
  await page.waitForFunction(()=>!window.clayPlayDebug.getState().pending,{},{timeout:20000});
  assert.ok(await page.evaluate(()=>window.clayPlayDebug.objects.active.volume.extrusion?.points.length>1));
  console.log(JSON.stringify({result:'slow-cadence palm extrusion saved',phases:states.map(s=>s.palmPhase),extrudeStates:states.map(s=>s.extrude)}));
};
if(require.main===module)(async()=>{
  const {chromium}=require(process.argv[2] || process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await module.exports(page);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
