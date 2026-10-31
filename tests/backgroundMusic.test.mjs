import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundMusic,shuffledTracks } from '../src/backgroundMusic.js';

const tracks=['one.mp3','two.mp3','three.mp3','four.mp3','five.mp3'];
function fixture(saved=null) {
  let created=0,callback;
  const audio={paused:true,currentTime:0,starts:[],
    play(){this.paused=false;this.starts.push(this.src);return Promise.resolve();},
    pause(){this.paused=true;},removeAttribute(){this.src='';},load(){this.unloaded=true;}};
  const writes=[];
  const music=new BackgroundMusic({tracks,random:()=>.3,createAudio:()=>{created++;return audio;},
    storage:{getItem:()=>saved,setItem:(...args)=>writes.push(args)},
    schedule:fn=>{callback=fn;return 1;},cancel:()=>{callback=null;}});
  return {music,audio,writes,created:()=>created,restoreVolume:()=>callback?.()};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Playlist shuffles each track once and avoids repeating across rounds',()=>{
  const first=shuffledTracks(tracks,()=>.5);
  assert.deepEqual([...first].sort(),[...tracks].sort());
  const next=shuffledTracks(tracks,()=>.5,first[0]);assert.notEqual(next[0],first[0]);
  assert.deepEqual(shuffledTracks(['one','one']),['one']);
});

test('No music is fetched before interaction; only one low-volume stream plays each round',async()=>{
  const f=fixture();assert.equal(f.created(),0);assert.equal(f.audio.src,undefined);
  await f.music.activate();assert.equal(f.created(),1);assert.equal(f.audio.preload,'none');
  assert.equal(f.audio.loop,false);assert.equal(f.audio.volume,.07);
  for(let i=0;i<10;i++){f.audio.paused=true;f.audio.onended();await settle();}
  assert.equal(f.created(),1);
  const heard=f.audio.starts;
  assert.equal(new Set(heard.slice(0,5)).size,5);assert.equal(new Set(heard.slice(5,10)).size,5);
  assert.notEqual(heard[4],heard[5]);assert.notEqual(heard[9],heard[10]);
});

test('Hiding pauses immediately and returning resumes the same position, with no new track',async()=>{
  const {music,audio}=fixture();await music.activate();const source=audio.src;
  audio.currentTime=42;music.setForeground(false);assert.equal(audio.paused,true);
  await music.activate();assert.equal(audio.starts.length,1,'clicks outside the foreground do not start music');
  music.setForeground(true);await settle();assert.equal(audio.src,source);assert.equal(audio.currentTime,42);assert.equal(audio.paused,false);
});

test('Music mute is remembered independently and survives focus changes',async()=>{
  const f=fixture('off');await f.music.activate();assert.equal(f.created(),0);
  await f.music.toggle();assert.equal(f.audio.paused,false);
  f.music.toggle();assert.equal(f.audio.paused,true);assert.deepEqual(f.writes.at(-1),['clayplay-music','off']);
  f.music.setForeground(false);f.music.setForeground(true);await settle();assert.equal(f.audio.paused,true);
});

test('A blocked autoplay waits for a real retry; broken files are skipped with bounded retries',async()=>{
  const {music,audio}=fixture(),play=audio.play;
  audio.play=()=>Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'}));
  await music.activate();const current=audio.src;assert.equal(music.failed.size,0);
  audio.play=play;await music.activate();assert.equal(audio.src,current);assert.equal(audio.paused,false);
  audio.onerror();await settle();assert.notEqual(audio.src,current);assert.ok(music.failed.has(current));
  for(let i=0;i<5;i++){audio.onerror();await settle();}
  assert.equal(music.current,null);assert.equal(audio.paused,true);assert.equal(music.failed.size,5);
});

test('Tool notes briefly lower music, and disposing releases the stream',async()=>{
  const f=fixture();await f.music.activate();f.music.duck();assert.ok(f.audio.volume<.03);
  f.restoreVolume();assert.equal(f.audio.volume,.07);
  f.music.dispose();assert.equal(f.audio.paused,true);assert.equal(f.audio.unloaded,true);
  assert.equal(f.audio.onended,null);await f.music.activate();assert.equal(f.created(),1);
});

test('A late play promise cannot restart music after it is muted or disposed',async()=>{
  const {music,audio}=fixture();let finish;
  audio.play=()=>new Promise(resolve=>{finish=()=>{audio.paused=false;resolve();};});
  const pending=music.activate();music.toggle();finish();await pending;
  assert.equal(audio.paused,true);
  const broken=new BackgroundMusic({tracks,storage:null,createAudio(){throw new Error('unsupported');}});
  await assert.doesNotReject(()=>broken.activate());
});

test('Returning during a pending startup retries a canceled play request once',async()=>{
  const {music,audio}=fixture(),play=audio.play;let reject;
  audio.play=()=>new Promise((resolve,fail)=>{reject=fail;});
  const pending=music.activate();music.setForeground(false);music.setForeground(true);
  audio.play=play;reject(Object.assign(new Error('interrupted'),{name:'AbortError'}));
  await pending;await settle();assert.equal(audio.paused,false);assert.equal(audio.starts.length,1);
});
