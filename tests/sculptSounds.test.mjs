import test from 'node:test';
import assert from 'node:assert/strict';
import { SculptSounds, SOUND_PROFILES, editNote } from '../src/sculptSounds.js';

function setup(saved = null) {
  const automation=[];
  const param=()=>Object.fromEntries(['setValueAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime','setTargetAtTime','cancelScheduledValues'].map(name=>[name,(...args)=>automation.push([name,...args])]));
  const voices=[],gains=[],writes=[];
  const context={state:'running',currentTime:10,destination:{},
    createOscillator(){const v={frequency:param(),connect(){},disconnect(){},start(t){this.started=t;},stop(t){this.stopped=t;}};voices.push(v);return v;},
    createGain(){const g={gain:param(),connect(){},disconnect(){}};gains.push(g);return g;},
    async resume(){this.state='running';},close(){this.state='closed';}};
  const sound=new SculptSounds({createContext:()=>context,storage:{getItem:()=>saved,setItem:(...args)=>writes.push(args)}});
  return {sound,context,voices,gains,automation,writes};
}

test('Every tool has a distinct single-note identity; larger edits stay musical and bounded',()=>{
  assert.equal(new Set(Object.values(SOUND_PROFILES).map(p=>p.midi)).size,Object.keys(SOUND_PROFILES).length);
  for(const tool of Object.keys(SOUND_PROFILES)) {
    const small=editNote(tool,.05),large=editNote(tool,1);
    assert.ok(large.frequency>small.frequency);assert.ok(large.volume>small.volume);
    assert.ok(large.volume<=.07);assert.ok(large.duration<.4);
    assert.deepEqual(editNote(tool,100),large);assert.deepEqual(editNote(tool,-10),editNote(tool,0));
    assert.ok(Number.isFinite(editNote(tool,NaN).frequency));
  }
  assert.deepEqual(editNote('pinch'),editNote('pull'));assert.equal(editNote('unknown'),null);
});

test('One completion makes one oscillator with a soft attack and automatic end',async()=>{
  const {sound,voices,automation}=setup();await sound.unlock();
  assert.equal(voices.length,0,'unlock does not play a note');
  assert.equal(sound.play('pull',.6),true);assert.equal(voices.length,1);
  assert.equal(voices[0].started,10);assert.ok(voices[0].stopped>10 && voices[0].stopped<10.4);
  assert.equal(automation.filter(([kind])=>kind==='linearRampToValueAtTime').length,1);
  assert.equal(automation.filter(([kind])=>kind==='exponentialRampToValueAtTime').length,1);
  voices[0].onended();assert.equal(sound.notes.size,0);
});

test('Mute preference persists, stops active notes and never queues stale completions',async()=>{
  const f=setup();assert.equal(f.sound.enabled,true);await f.sound.unlock();
  f.sound.play('paint');f.sound.toggle();assert.equal(f.sound.notes.size,0);
  assert.deepEqual(f.writes.at(-1),['clayplay-sound','off']);
  assert.equal(f.sound.play('pull'),false);assert.equal(f.voices.length,1);
  const muted=setup('off');await muted.sound.unlock();assert.equal(muted.sound.context.state,'running');
  assert.equal(muted.sound.play('pull'),false);assert.equal(muted.voices.length,0,'preparing audio never overrides mute');
  await muted.sound.toggle();assert.equal(muted.voices.length,1,'enabling sound by hand gives an audible confirmation');
  const fresh=setup();assert.equal(fresh.sound.play('erase'),false);await fresh.sound.unlock();
  fresh.context.state='suspended';assert.equal(fresh.sound.play('erase'),false);
  await fresh.sound.unlock();assert.equal(fresh.voices.length,0,'resume does not replay missed notes');
});

test('Fast queued edits stay bounded and audio failures never interrupt editing',async()=>{
  const {sound,voices}=setup();await sound.unlock();
  for(let i=0;i<12;i++)assert.equal(sound.play('extrude',.5),true);
  assert.equal(sound.notes.size,3);assert.equal(voices.length,12);
  sound.dispose();assert.equal(sound.notes.size,0);assert.equal(sound.play('pull'),false);
  const unavailable=new SculptSounds({createContext(){throw Error('unsupported');},storage:null});
  await unavailable.unlock();assert.equal(unavailable.play('pull'),false);
});
