import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraBackdrop, cameraCoverPoint } from '../src/arView.js';

test('Mirrored camera coordinates match object-fit cover across wide, tall and resized stages', () => {
  for (const [sw, sh, vw, vh] of [[1280,720,686,558],[1280,720,1220,680],[1280,720,1920,600],[720,1280,320,380],[640,480,700,500]]) {
    const scale = Math.max(vw / sw, vh / sh);
    for (const p of [{x:0,y:0},{x:.2,y:.7},{x:.5,y:.5},{x:1,y:1}]) {
      const mapped = cameraCoverPoint(p,sw,sh,vw,vh);
      assert.ok(Math.abs(mapped.x * vw - ((1-p.x)*sw*scale - (sw*scale-vw)/2)) < 1e-9);
      assert.ok(Math.abs(mapped.y * vh - (p.y*sh*scale - (sh*scale-vh)/2)) < 1e-9);
    }
    assert.deepEqual(cameraCoverPoint({x:.5,y:.5},sw,sh,vw,vh), {x:.5,y:.5});
  }
  assert.ok(cameraCoverPoint({x:0,y:0},1280,720,320,380).x > 1, 'Cropped-out hands stay outside the stage');
});

function backdrop(play = async () => {}) {
  const classes = new Map(), attributes = new Map(), state = { textContent: '' };
  const video = { paused: true, readyState: 0, srcObject: null, hidden: true,
    async play() { await play(); this.paused = false; this.readyState = 2; }, pause() { this.paused = true; } };
  let changes = 0, errors = 0;
  const view = new CameraBackdrop({ video, button: { setAttribute(k,v) {attributes.set(k,v);}, classList:{toggle(k,v){classes.set(k,v);}}, querySelector(){return state;} },
    stage:{classList:{toggle(k,v){classes.set(k,v);}}}, scene:{background:'studio'}, renderer:{setClearAlpha(v){classes.set('alpha',v);}},
    onChange(){changes++;}, onError(){errors++;} });
  return { view, video, classes, attributes, state, changes:()=>changes, errors:()=>errors };
}

test('AR turns on only after video is ready and restores the studio without stopping camera tracks', async () => {
  const f = backdrop(); let stopped = 0;
  const stream = { getTracks(){return [{stop(){stopped++;}}];} };
  f.view.setEnabled(true); assert.equal(f.view.live,false); assert.equal(f.state.textContent,'Starting…');
  await f.view.attachStream(stream);
  assert.equal(f.view.live,true); assert.equal(f.view.scene.background,null); assert.equal(f.classes.get('alpha'),0);
  f.view.setEnabled(false);
  assert.equal(f.view.live,false); assert.equal(f.view.scene.background,'studio'); assert.equal(f.classes.get('alpha'),1);
  assert.equal(f.video.srcObject,null); assert.equal(f.video.hidden,true); assert.equal(f.attributes.get('aria-pressed'),'false');
  assert.equal(f.changes(),2); assert.equal(stopped,0);
});

test('Pending AR playback can be canceled and playback failures restore normal mode', async () => {
  let resolve; const waiting = new Promise(r=>{resolve=r;});
  const f = backdrop(()=>waiting);
  f.view.setEnabled(true); const pending = f.view.attachStream({});
  f.view.setEnabled(false); resolve(); await pending;
  assert.equal(f.view.live,false); assert.equal(f.video.srcObject,null); assert.equal(f.errors(),0);
  const failed = backdrop(()=>Promise.reject(new Error('Playback unavailable')));
  failed.view.setEnabled(true); await failed.view.attachStream({});
  assert.equal(failed.view.enabled,false); assert.equal(failed.view.live,false); assert.equal(failed.errors(),1);
});
