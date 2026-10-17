import test from 'node:test';
import assert from 'node:assert/strict';
import { SculptSounds, SOUND_PROFILES } from '../src/sculptSounds.js';

function setup() {
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  let voices = 0;
  const context = { state:'running', currentTime:0, destination:{},
    createOscillator() { voices++; return {frequency:param(),connect(){},start(){}}; },
    createGain() { return {gain:param(),connect(){}}; }, close(){} };
  const sound = new SculptSounds({createContext:()=>context,storage:{getItem(){return 'on';},setItem(){}}});
  return {sound,voices:()=>voices};
}
test('Sounds respond to pull distance, stay bounded, and reuse one voice',async()=>{
  const {sound,voices}=setup(); await sound.unlock();
  sound.update('pinch',[0,0,0],.1,0); const quiet=sound.gain.gain.value, low=sound.voice.frequency.value;
  sound.update('pinch',[1,0,0],1,100);
  assert.ok(sound.gain.gain.value>quiet); assert.ok(sound.voice.frequency.value>low);
  for(let i=0;i<100;i++)sound.update('extrude',[i,0,0],100,i*16);
  assert.ok(sound.gain.gain.value<=.075); assert.equal(voices(),2);
  sound.stop(); assert.equal(sound.gain.gain.value,0);
});
test('Mute and lost contact silence immediately; resting paint fades to zero',async()=>{
  const {sound}=setup(); await sound.unlock();
  sound.update('paint',[0,0,0],0,0);sound.update('paint',[.1,0,0],0,16);
  assert.ok(sound.gain.gain.value>0);
  sound.update('paint',[.1,0,0],0,32);assert.equal(sound.gain.gain.value,0);
  sound.update('paint',null);assert.equal(sound.point,null);
  sound.toggle();sound.update('pinch',[1,0,0],1);assert.equal(sound.gain.gain.value,0);
  assert.equal(new Set(Object.values(SOUND_PROFILES).map(p=>p.base)).size,5);
});
test('Unavailable audio does not break sculpting',async()=>{
  const sound=new SculptSounds({createContext(){throw Error('unsupported');},storage:null});
  await sound.unlock();assert.doesNotThrow(()=>sound.update('pinch',[0,0,0],1));
});
