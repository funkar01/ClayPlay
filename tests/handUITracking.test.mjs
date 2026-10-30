import test from 'node:test';
import assert from 'node:assert/strict';
import { HandUI, HAND_UI_SAMPLE_AGE_MS, rangeValueAt } from '../src/handUI.js';
import { HandSelection, ControlHand } from '../src/handSelection.js';
import { HandMotion } from '../src/handMotion.js';
import { palmHand } from './helpers/palmHand.mjs';

function fixture() {
  const ui = Object.create(HandUI.prototype), styles = new Map(); let clicks = 0;
  const target = { id: 'next', isConnected: true, disabled: false,
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 550, right: 650, top: 250, bottom: 350 }),
    getAttribute: () => 'Next', click: () => clicks++ };
  Object.assign(ui, {
    selection: new HandSelection(), identity: new ControlHand({ graceMs: 650 }),
    motion: new HandMotion({ staleMs: HAND_UI_SAMPLE_AGE_MS }), lastAt: null, gapAt: null,
    panel: { hidden: true }, cursor: { hidden: true, dataset: {}, style: { setProperty: (key, value) => styles.set(key, value) } },
    feedback: { hidden: true }, stage: { querySelector: () => null, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    mapPoint: p => ({ x: p.x * 1000, y: p.y * 1000 }), sync() {}, visible: () => true,
    hit: p => p.x >= 550 && p.x <= 650 && p.y >= 250 && p.y <= 350 ? target : null,
  });
  const points = Array.from({ length: 21 }, () => ({ x: .6, y: .38, z: 0 }));
  points[0].y = .5; points[5] = { x: .55, y: .4, z: 0 };
  points[9].y = .39; points[17] = { x: .68, y: .42, z: 0 };
  for (const [joint, tip, dx] of [[6,8,0],[10,12,.025],[14,16,.06],[18,20,.095]]) {
    points[joint] = { x: .6 + dx, y: .36, z: 0 }; points[tip] = { x: .6 + dx, y: .3, z: 0 };
  }
  points[4] = { x: .52, y: .3, z: 0 };
  const result = { landmarks: [points], handedness: [[{ categoryName: 'Left' }]] };
  return { ui, result, target, styles, clicks: () => clicks };
}

test('Held tool aim and drawn cursor share one measured point without prediction drift', () => {
  const { ui, result } = fixture();
  ui.receive(result, 0, { blocked: true });
  const moved = structuredClone(result);
  for (const point of moved.landmarks[0]) { point.x += .03; point.y += .02; }
  ui.receive(moved, 35, { blocked: true });
  ui.cursor.dataset.gesture = 'held';
  ui.drawCursor(50);
  assert.deepEqual(ui.getPointer(), ui.getPointer(true));
  assert.match(ui.cursor.style.transform, /translate\(-50%, -50%\)/);
  ui.suspend(70);
  assert.equal(ui.getPointer(), null, 'a suspended hand must not provide a fresh tool target');
  ui.lose();
  assert.equal(ui.getPointer(true), null);
});

test('Size slider requires a pinch, captures the drag outside the track, and stops on release',()=>{
  const f=fixture(),{ui,result,target}=f;
  target.id='tool-size';target.min='0';target.max='90';target.step='1';target.value='24';
  target.getBoundingClientRect=()=>({left:550,right:650,top:250,bottom:350,width:100});
  const changes=[];ui.onAction=(action,value)=>{assert.equal(action,'size');changes.push(value);target.value=String(value);};
  for(const now of [0,100,200,300,400])ui.receive(result,now);
  assert.equal(changes.length,0);
  ui.receive(result,500);assert.equal(changes.length,0,'pointing alone never changes size');
  const pinched=structuredClone(result);pinched.landmarks[0][4].x=.59;
  ui.receive(pinched,600);assert.ok(ui.sizeDrag);assert.equal(target.value,'24','grabbing does not jump the thumb');
  const shifted=structuredClone(pinched);shifted.landmarks[0][4].x+=.09;shifted.landmarks[0][8].x+=.09;
  assert.equal(ui.receive(shifted,700).owns,true);
  assert.ok(changes.at(-1)>24);assert.equal(f.clicks(),0);
  const count=changes.length;
  const released=structuredClone(shifted);released.landmarks[0][4].x-=.08;
  assert.equal(ui.receive(released,800).owns,true,'release frame stays captured');
  assert.equal(ui.sizeDrag,null);assert.equal(changes.length,count);
  ui.receive(released,900);assert.equal(changes.length,count);
});

test('Slider dragging freezes on blocked input or missing hand measurements',()=>{
  const {ui,result,target}=fixture();
  target.id='tool-size';target.min='0';target.max='90';target.step='1';target.value='24';
  target.getBoundingClientRect=()=>({left:550,right:650,top:250,bottom:350,width:100});
  let changes=0;ui.onAction=()=>changes++;
  const pinched=structuredClone(result);pinched.landmarks[0][4].x=.59;
  ui.receive(pinched,0);assert.ok(ui.sizeDrag);
  ui.receive(pinched,100,{blocked:true});assert.equal(ui.sizeDrag,null);
  ui.receive(pinched,200);assert.ok(ui.sizeDrag);
  ui.receive({landmarks:[]},250);assert.equal(ui.sizeDrag,null);assert.equal(changes,0);
});

test('HSV sliders use pinch capture and input events without invoking sculpt size',()=>{
  const {ui,result,target}=fixture();
  Object.assign(target,{id:'paint-hue',min:'0',max:'360',step:'1',value:'120',hasAttribute:name=>name==='data-hand-range'});
  target.getBoundingClientRect=()=>({left:550,right:650,top:250,bottom:350,width:100});
  let inputs=0;target.dispatchEvent=event=>{assert.equal(event.type,'input');inputs++;};
  ui.onAction=()=>assert.fail('color slider must not resize the sculpt brush');
  ui.receive(result,0);assert.equal(inputs,0);
  const pinched=structuredClone(result);pinched.landmarks[0][4].x=.59;
  ui.receive(pinched,100);assert.ok(ui.sizeDrag);assert.equal(inputs,0);
  pinched.landmarks[0][4].x+=.09;pinched.landmarks[0][8].x+=.09;
  assert.equal(ui.receive(pinched,200).owns,true);assert.ok(inputs>0);assert.ok(Number(target.value)>120);
  ui.receive({landmarks:[]},250);assert.equal(ui.sizeDrag,null);
});

test('Size slider maps left, center and right to reachable stepped values',()=>{
  const rect={left:100,width:300};
  assert.equal(rangeValueAt(100,rect),0);assert.equal(rangeValueAt(250,rect),45);
  assert.equal(rangeValueAt(400,rect),90);assert.equal(rangeValueAt(999,rect),90);
  assert.equal(rangeValueAt(-100,rect),0);
});

test('Palm mode adjusts sliders by closing and moving the palm, without a finger pinch',()=>{
  const {ui,target}=fixture();ui.controlMode='palm';ui.hit=()=>target;
  Object.assign(target,{id:'tool-size',min:'0',max:'90',step:'1',value:'24'});
  target.getBoundingClientRect=()=>({left:400,right:700,top:250,bottom:350,width:300});
  ui.mapPoint=p=>({x:p.x*1000,y:300});
  let changes=0;ui.onAction=(action,value)=>{assert.equal(action,'size');target.value=String(value);changes++;};
  const result=points=>({landmarks:[points],handedness:[[{categoryName:'Left'}]]});
  ui.receive(result(palmHand()),0);ui.receive(result(palmHand()),100);
  assert.equal(changes,0,'open-palm hovering does not move the slider');
  ui.receive(result(palmHand(true)),150);ui.receive(result(palmHand(true)),260);
  assert.ok(ui.sizeDrag);assert.equal(changes,0,'grabbing preserves the slider value');
  ui.receive(result(palmHand(true,.06)),300);assert.ok(changes>0);assert.ok(Number(target.value)>24);
  const count=changes;ui.receive(result(palmHand(false,.06)),330);
  assert.equal(ui.sizeDrag,null);assert.equal(changes,count,'opening releases without extending the drag');
});

test('A missed detection keeps the painted pointer and dwell ring visible, then resumes one click', () => {
  const f = fixture(), { ui, result } = f;
  ui.receive(result, 0); ui.receive(result, 100); ui.receive(result, 200);
  const position = ui.cursor.style.transform, progress = f.styles.get('--dwell-progress');
  ui.receive({ landmarks: [] }, 240); ui.tick(300); ui.tick(340);
  assert.equal(ui.cursor.hidden, false); assert.equal(ui.cursor.style.transform, position);
  assert.equal(f.styles.get('--dwell-progress'), progress); assert.equal(f.clicks(), 0);
  ui.receive(result, 380); assert.equal(f.styles.get('--dwell-progress'), progress);
  for (const now of [480, 580, 680, 780]) ui.receive(result, now);
  assert.equal(f.clicks(), 1); assert.equal(ui.cursor.hidden, false);
});

test('Regular valid results older than the sculpt threshold do not blink the UI pointer', () => {
  const { ui, result } = fixture();
  ui.receive(result, 300, { sampleAt: 50 }); ui.tick(420);
  assert.equal(ui.cursor.hidden, false);
  ui.receive(result, 450, { sampleAt: 200 }); ui.tick(580);
  assert.equal(ui.cursor.hidden, false);
});

test('A long dropout clears the cursor and countdown; reacquisition starts a new hold', () => {
  const f = fixture(), { ui, result } = f;
  ui.receive(result, 0); ui.receive(result, 200); ui.receive({ landmarks: [] }, 240);
  ui.tick(851); assert.equal(ui.cursor.hidden, true); assert.equal(ui.selection.hover, null);
  ui.receive(result, 900);
  assert.equal(ui.cursor.hidden, false); assert.equal(f.styles.get('--dwell-progress'), '0deg'); assert.equal(f.clicks(), 0);
});

test('Malformed or stale samples hold feedback without activating; hard reset hides immediately', () => {
  const f = fixture(), { ui, result } = f;
  ui.receive(result, 0); ui.receive(result, 200);
  const malformed = structuredClone(result); malformed.landmarks[0][8].x = NaN;
  ui.receive(malformed, 240); ui.tick(260); assert.equal(ui.cursor.hidden, false);
  ui.receive(result, 300, { sampleAt: -300 }); ui.tick(400);
  assert.equal(f.clicks(), 0); assert.equal(ui.cursor.hidden, false);
  ui.reset(); assert.equal(ui.cursor.hidden, true); assert.equal(ui.selection.hover, null);
});

for (const mode of ['index', 'palm']) {
  test(`Tutorial practice button activates once by open-hand dwell in ${mode} mode`, () => {
    const f = fixture(), { ui, target } = f;
    ui.controlMode = mode;
    target.id = 'tutorial-next';
    const tutorial = { getBoundingClientRect: () => ({ left:500, right:700, top:200, bottom:400 }), contains: item => item === target };
    ui.stage.querySelector = () => tutorial;
    ui.mapPoint = () => ({ x:600, y:300 });
    ui.hit = (point, root) => { assert.equal(root, tutorial); return target; };
    const result = mode === 'palm' ? { landmarks:[palmHand()], handedness:[[{ categoryName:'Left' }]] } : f.result;
    for (const now of [0,100,200,300,400]) ui.receive(result, now);
    assert.equal(f.clicks(), 0, 'moving onto the button is not an immediate click');
    for (const now of [500,600,700,800,900]) ui.receive(result, now);
    assert.equal(f.clicks(), 1, 'holding an open hand completes the selection once');
  });
}

test('Dock reveal is offered only by open input, never a pinch or active sculpting frame',()=>{
 const {ui,result}=fixture();const allowed=[];ui.recordDockHand=(_point,_now,open)=>allowed.push(open);
 ui.receive(result,0);assert.equal(allowed.at(-1),true);
 const grip=structuredClone(result);grip.landmarks[0][4].x=.59;
 ui.receive(grip,100);assert.equal(allowed.at(-1),false);
 ui.receive(result,200,{blocked:true});assert.equal(allowed.at(-1),false);
});

test('Collection actions start separate dwell timers when the selected action changes',()=>{
  const f=fixture(),{ui,target,result}=f;ui.selection.dwellMs=500;
  target.id='';target.dataset={collection:'login'};
  for(const now of [0,100,200])ui.receive(result,now);
  target.dataset.collection='register';
  for(const now of [350,450,550,650,750])ui.receive(result,now);
  assert.equal(f.clicks(),0,'Dwell on Sign in cannot carry over to registration');
  ui.receive(result,850);assert.equal(f.clicks(),1);
});
