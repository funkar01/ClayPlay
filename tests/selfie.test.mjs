import test from 'node:test';
import assert from 'node:assert/strict';
import {SelfieStudio,SelfieCountdown,cameraCoverRect,composeSelfie,selfieShareData,CLAYPLAY_URL} from '../src/selfie.js';

test('Selfie captures once, exactly two seconds after a valid worn mask',()=>{
  const clock=new SelfieCountdown();clock.start(0);
  assert.equal(clock.tick(100,false),'waiting');
  assert.equal(clock.tick(300,true),2);
  assert.equal(clock.tick(1299,true),2);
  assert.equal(clock.tick(1300,true),1);
  assert.equal(clock.tick(2299,true),1);
  assert.equal(clock.tick(2300,true),'capture');
  assert.equal(clock.tick(2400,true),'idle');
});

test('Face loss restarts the countdown; cancel and timeout never capture',()=>{
  const clock=new SelfieCountdown();clock.start(0);clock.tick(0,true);
  assert.equal(clock.tick(1800,false),'waiting');
  assert.equal(clock.tick(1900,true),2);
  assert.equal(clock.tick(2100,true),2);
  clock.cancel();assert.equal(clock.tick(4000,true),'idle');
  clock.start(5000);assert.equal(clock.tick(30000,false),'timeout');
  assert.equal(clock.tick(30010,true),'idle');
});

test('Camera cover crop matches landscape and portrait viewports',()=>{
  assert.deepEqual(cameraCoverRect(1920,1080,1600,900),{x:0,y:0,width:1600,height:900});
  const portrait=cameraCoverRect(1920,1080,600,900);
  assert.equal(portrait.x,-500);assert.equal(portrait.y,0);assert.equal(portrait.width,1600);
  const wide=cameraCoverRect(1080,1920,1600,900);
  assert.equal(wide.x,0);assert.ok(wide.y<0);assert.equal(wide.width,1600);
});

test('Capture mirrors only the camera then draws the mask in the same render turn',async()=>{
  const calls=[],blob=new Blob(['photo'],{type:'image/jpeg'});
  const video={videoWidth:1920,videoHeight:1080,readyState:2},mask={width:2560,height:1440};
  const context={save(){calls.push(['save']);},translate(...args){calls.push(['translate',...args]);},scale(...args){calls.push(['scale',...args]);},drawImage(...args){calls.push(['draw',...args]);},restore(){calls.push(['restore']);}};
  const canvas={getContext:()=>context,toBlob(callback,type,quality){calls.push(['encode',type,quality]);callback(blob);}};
  const promise=composeSelfie(video,mask,()=>canvas);
  assert.equal(calls[3][1],video,'camera pixels are copied synchronously before encoding');
  assert.equal(calls[5][1],mask,'mask is copied after restoring the mirror transform');
  assert.deepEqual(calls[2],['scale',-1,1]);
  assert.equal(canvas.width,1600);assert.equal(canvas.height,900);
  assert.equal(await promise,blob);assert.deepEqual(calls[6],['encode','image/jpeg',.93]);
});

test('Unavailable camera and failed encoding report errors rather than blank selfies',async()=>{
  await assert.rejects(composeSelfie({videoWidth:0},{}),/Camera is not ready/);
  const video={videoWidth:100,videoHeight:100,readyState:2};
  const ctx={save(){},translate(){},scale(){},drawImage(){},restore(){}};
  await assert.rejects(composeSelfie(video,{width:100,height:100},()=>({getContext:()=>ctx,toBlob:callback=>callback(null)})),/Could not create/);
});

test('Share data includes the captured image and exact application URL',()=>{
  const file=new File(['photo'],'mask.jpg',{type:'image/jpeg'}),data=selfieShareData(file);
  assert.deepEqual(data.files,[file]);assert.ok(data.text.includes(CLAYPLAY_URL));
  assert.equal(data.text,`Creating the masks is fun, want to try it out? ${CLAYPLAY_URL}`);
  assert.equal(data.text.split(CLAYPLAY_URL).length-1,1);
  assert.equal(data.url,undefined,'do not send the same URL separately from the message');
});

function studioFixture(t,prepare) {
  const previous=globalThis.document,nodes=new Map();let encoded,exits=0;
  const node=()=>({hidden:true,isConnected:true,focus(){},remove(){},removeAttribute(){},setAttribute(){},addEventListener(){},classList:{add(){},remove(){}}});
  const root={...node(),querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);}};
  const ctx={save(){},translate(){},scale(){},drawImage(){},restore(){}};
  globalThis.document={activeElement:node(),createElement:tag=>tag==='canvas'?{getContext:()=>ctx,toBlob(callback){encoded=callback;}}:root};
  const studio=new SelfieStudio({stage:{append(){}},prepare,onExit(){exits++;}});
  t.after(()=>{studio.dispose();globalThis.document=previous;});
  return {studio,exits:()=>exits,finishEncoding:()=>encoded(new Blob(['image'],{type:'image/jpeg'}))};
}

test('Closing while the camera starts cancels the eventual countdown',async t=>{
  let ready;const f=studioFixture(t,()=>new Promise(resolve=>{ready=resolve;}));
  const pending=f.studio.start();assert.equal(f.studio.busy,true);
  f.studio.close();ready(true);await pending;
  assert.equal(f.studio.phase,'idle');assert.equal(f.studio.element.hidden,true);
  assert.equal(f.studio.countdown.active,false);assert.equal(f.exits(),1);
});

test('A late image encoder result cannot reopen a closed selfie preview',async t=>{
  const f=studioFixture(t,async()=>true);await f.studio.start();
  const now=performance.now(),frame={ready:true,video:{videoWidth:100,videoHeight:100,readyState:2},canvas:{width:100,height:100}};
  f.studio.tick(now,frame);f.studio.tick(now+2001,frame);
  assert.equal(f.studio.phase,'encoding');f.studio.close();f.finishEncoding();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(f.studio.phase,'idle');assert.equal(f.studio.url,null);
  assert.equal(f.studio.element.hidden,true);
});
