import test from 'node:test';
import assert from 'node:assert/strict';
import { HandUI, HAND_UI_SAMPLE_AGE_MS, rangeValueAt } from '../src/handUI.js';
import { HandSelection, ControlHand } from '../src/handSelection.js';
import { HandMotion } from '../src/handMotion.js';

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

test('Size slider maps left, center and right to reachable stepped values',()=>{
  const rect={left:100,width:300};
  assert.equal(rangeValueAt(100,rect),0);assert.equal(rangeValueAt(250,rect),45);
  assert.equal(rangeValueAt(400,rect),90);assert.equal(rangeValueAt(999,rect),90);
  assert.equal(rangeValueAt(-100,rect),0);
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
