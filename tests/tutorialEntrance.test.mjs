import test from 'node:test';
import assert from 'node:assert/strict';
import {TutorialEntrance} from '../src/tutorialEntrance.js';

function fixture({reduced=false,cardBox={left:1580,top:80,width:300,height:254},stageBox={left:0,top:0,width:1900,height:990}}={}) {
  const animations=[],listeners=new Map();let settled=0;
  const card={getBoundingClientRect:()=>cardBox,animate(frames,options){
    const animation={frames,options,cancel(){this.cancelled=true;this.oncancel?.();}};
    animations.push(animation);return animation;
  }};
  const entrance=new TutorialEntrance({card,stage:{getBoundingClientRect:()=>stageBox},
    onSettled(){settled++;},reducedMotion:()=>reduced,
    events:{addEventListener(type,callback){listeners.set(type,callback);},removeEventListener(type){listeners.delete(type);}}});
  return {entrance,card,animations,listeners,settled:()=>settled};
}

test('Tutorial holds at the stage center, then slides to its dock and settles once',()=>{
  const f=fixture();f.entrance.start();const animation=f.animations[0];
  assert.equal(f.entrance.running,true);assert.equal(f.settled(),0);
  assert.equal(animation.frames[0].transform,'translate(-780px, 288px)');
  assert.equal(animation.frames[1].transform,animation.frames[0].transform);
  assert.equal(animation.frames[1].offset*animation.options.duration,1400);
  assert.equal(animation.frames[2].transform,'translate(0px, 0px)');
  animation.onfinish();assert.equal(f.entrance.running,false);assert.equal(f.settled(),1);
  assert.equal(f.listeners.size,0);animation.onfinish();assert.equal(f.settled(),1);
});

test('Reduced motion and unsupported animation keep the tutorial immediately usable',()=>{
  const reduced=fixture({reduced:true});reduced.entrance.start();
  assert.equal(reduced.animations.length,0);assert.equal(reduced.entrance.running,false);assert.equal(reduced.settled(),1);
  const unsupported=fixture();delete unsupported.card.animate;unsupported.entrance.start();
  assert.equal(unsupported.entrance.running,false);assert.equal(unsupported.settled(),1);
});

test('Skipping, resizing, and restarting discard the old entrance without late callbacks',()=>{
  const f=fixture();f.entrance.start();const first=f.animations[0];
  f.entrance.cancel();assert.equal(first.cancelled,true);assert.equal(f.settled(),1);
  f.entrance.start();const second=f.animations[1];first.onfinish();
  assert.equal(f.entrance.running,true);assert.equal(f.settled(),1);
  f.listeners.get('resize')();assert.equal(second.cancelled,true);assert.equal(f.entrance.running,false);assert.equal(f.settled(),2);
  f.entrance.start();const third=f.animations[2];f.entrance.start();
  assert.equal(third.cancelled,true);third.onfinish();assert.equal(f.entrance.running,true);assert.equal(f.settled(),2);
  f.animations[3].onfinish();assert.equal(f.settled(),3);
});

test('Centering follows the real stage and responsive card dimensions',()=>{
  const f=fixture({stageBox:{left:40,top:100,width:360,height:700},cardBox:{left:52,top:600,width:336,height:188}});
  f.entrance.start();assert.equal(f.animations[0].frames[0].transform,'translate(0px, -244px)');
  f.entrance.cancel();
});
