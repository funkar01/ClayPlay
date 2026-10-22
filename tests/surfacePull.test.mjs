import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SurfacePull } from '../src/surfacePull.js';
import { enablePaintMaterial,applyVertexPaint } from '../src/paintLayer.js';

function fixture(t,{beforeBegin,anchor=new THREE.Vector3()}={}) {
  const previousWorker = globalThis.Worker, previousDocument = globalThis.document;
  globalThis.document = { dispatchEvent() {} };
  globalThis.Worker = class {
    messages = [];
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, .1,0,0, 0,.1,0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
  const material = new THREE.MeshBasicMaterial(), parent = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material); parent.add(mesh);
  const volume = { bricks: new Map([['0,0,0', { mesh }]]), parent, material,
    snapshot: () => ({ original: true }), undoStack: [{}], field: new Map() };
  let changes = 0;
  const pull = new SurfacePull(volume, () => changes++);
  beforeBegin?.(volume);
  assert.equal(pull.begin(anchor, .336, .55), true);
  const worker = pull.worker;
  t.after(() => { pull.abort(); geometry.dispose(); material.dispose();
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  const response = (warp, final = false) => ({ warp, final, duration: 1, bricks: [{ key: '0,0,0',
    positions: new Float32Array([warp.delta[0],0,0, .1,0,0, 0,.1,0]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1]) }] });
  return { pull, worker, volume, geometry, response, changes: () => changes };
}

test('Starting a pull inserts its anchor without resampling unchanged paint',t=>{
  let texture,version,state;
  const f=fixture(t,{anchor:new THREE.Vector3(.02,.02,0),beforeBegin(volume){
    enablePaintMaterial(volume.material);
    volume.paint=new Map([['1,1,0',[1,0,0,1]]]);volume.paintCell=.02;
    // Install the paint texture as a preceding rendered paint stroke would.
    const geometry=volume.bricks.get('0,0,0').mesh.geometry;
    applyVertexPaint(volume,geometry);volume.material.onBeforeRender();
    state=volume.material.userData.surfacePaint;
    texture=state.texture;version=texture.version;
  }});
  assert.equal(f.geometry.attributes.position.count,9,'the interior grab subdivides the triangle');
  assert.equal(f.geometry.attributes.paintColor.count,9,'new vertices still have paint attributes');
  assert.equal(state.dirty,false,'subdivision must not invalidate the unchanged paint field');
  f.volume.material.onBeforeRender();
  assert.equal(state.texture,texture);
  assert.equal(texture.version,version,'the first grabbed frame does not rebuild or upload paint');
  // Real paint/field changes must continue to invalidate the texture.
  applyVertexPaint(f.volume,f.geometry);
  assert.equal(state.dirty,true);
});

test('Slow pull keeps its frozen preview and saves when the final reply arrives',t=>{
  const f=fixture(t),original=globalThis.setTimeout;let warning;
  globalThis.setTimeout=callback=>{warning=callback;return 0;};
  t.after(()=>{globalThis.setTimeout=original;});
  f.pull.update(new THREE.Vector3(.3,0,0));f.pull.finish();warning();
  assert.equal(f.pull.active,true);assert.equal(f.worker.terminated,undefined);
  assert.equal(f.pull.preview.uniforms.pullEnabled.value,1);
  const warp=f.pull.lastWarp;
  f.worker.reply(f.response(warp,true));
  assert.deepEqual(f.volume.pullWarp,warp);
  assert.equal(f.pull.preview.uniforms.pullEnabled.value,0);
});

for(const repartition of [false,true]) {
  test(`Pull ${repartition?'repartition':'replacement'} preserves transparent paint data on unpainted clay`,t=>{
    const f=fixture(t);enablePaintMaterial(f.volume.material);
    const base=f.volume.material.color.getHex();
    f.pull.update(new THREE.Vector3(.3,0,0));f.pull.finish();
    const response=f.response(f.pull.lastWarp,true);response.repartition=repartition;
    // A changed vertex count forces replacement even without repartitioning.
    response.bricks[0].positions=new Float32Array([...response.bricks[0].positions,...response.bricks[0].positions]);
    response.bricks[0].normals=new Float32Array([...response.bricks[0].normals,...response.bricks[0].normals]);
    f.worker.reply(response);
    const geometry=f.volume.bricks.get('0,0,0').mesh.geometry;
    const colors=geometry.getAttribute('paintColor');
    assert.ok(colors,'replacement geometry must provide the shader attribute');
    assert.equal(colors.count,geometry.attributes.position.count);
    assert.ok(colors.array.every(value=>value===0),'unpainted clay has transparent paint, not opaque black');
    assert.equal(f.volume.material.color.getHex(),base);
    assert.deepEqual(f.volume.material.defaultAttributeValues.paintColor,[0,0,0,0]);
    geometry.dispose();
  });
}

test('Live pull updates the GPU without queuing worker previews; release commits the last measured target', t => {
  const f = fixture(t);
  f.pull.update(new THREE.Vector3(.1, 0, 0));
  f.pull.preview.tick(0);
  assert.ok(f.pull.preview.uniforms.pullDelta.value.x > .05);
  const frozen = [...f.geometry.attributes.position.array];
  f.pull.update(new THREE.Vector3(.2, 0, 0));
  f.pull.update(new THREE.Vector3(.3, 0, 0));
  const held = f.pull.lastWarp;
  assert.equal(f.worker.messages.length, 1, 'Only the source mesh was sent during the hold');
  assert.deepEqual([...f.geometry.attributes.position.array], frozen, 'GPU preview leaves source geometry authoritative');
  f.pull.finish();
  assert.equal(f.pull.update(new THREE.Vector3(1, 0, 0)), null);
  assert.deepEqual(f.pull.preview.uniforms.pullDelta.value.toArray(), held.delta);
  const final = f.worker.messages.at(-1);
  assert.equal(final.final, true); assert.deepEqual(final.warp, held);
  f.worker.reply(f.response(final.warp, true));
  assert.notDeepEqual([...f.geometry.attributes.position.array], frozen);
  assert.deepEqual(f.volume.pullWarp, held);
  assert.equal(f.volume.undoStack.length, 1);
  assert.equal(f.volume.pulling, false); assert.equal(f.changes(), 1);
  assert.equal(f.worker.terminated, true);
  assert.equal(f.pull.preview.uniforms.pullEnabled.value, 0, 'Committed geometry is never warped twice');
});

test('A quick drag released before the first preview still deforms and keeps one history entry', t => {
  const f = fixture(t), original = [...f.geometry.attributes.position.array];
  f.pull.update(new THREE.Vector3(.3, 0, 0));
  f.pull.finish(); f.pull.finish();
  assert.deepEqual([...f.geometry.attributes.position.array], original);
  const final = f.worker.messages.at(-1);
  assert.deepEqual(final.warp.delta, [.3,0,0]);
  f.worker.reply(f.response(final.warp, true));
  assert.notDeepEqual([...f.geometry.attributes.position.array], original);
  assert.equal(f.volume.undoStack.length, 1); assert.equal(f.changes(), 1);
  assert.equal(f.volume.pulling, false);
});

test('Pinching without movement preserves exact geometry and removes empty history', t => {
  const f = fixture(t), original = [...f.geometry.attributes.position.array];
  f.pull.finish(); f.pull.finish();
  assert.equal(f.pull.update(new THREE.Vector3(.5, 0, 0)), null);
  const final = f.worker.messages.at(-1);
  assert.equal(final.final, true); assert.deepEqual(final.warp.delta, [0,0,0]);
  f.worker.reply(f.response(final.warp, true));
  assert.deepEqual([...f.geometry.attributes.position.array], original);
  assert.equal(f.volume.undoStack.length, 0); assert.equal(f.changes(), 0);
});

test('Returning to the grab origin before release cancels an earlier visible pull', t => {
  const f = fixture(t), original = [...f.geometry.attributes.position.array];
  f.pull.update(new THREE.Vector3(.3, 0, 0));
  f.pull.preview.tick(0);
  assert.ok(f.pull.preview.uniforms.pullDelta.value.x > .2);
  f.pull.update(new THREE.Vector3());
  f.pull.finish();
  f.worker.reply(f.response(f.worker.messages.at(-1).warp, true));
  assert.deepEqual([...f.geometry.attributes.position.array], original);
  assert.equal(f.volume.undoStack.length, 0); assert.equal(f.changes(), 0);
});

test('Aborting a GPU preview clears the shader and terminates its worker', t => {
  const f = fixture(t);
  f.pull.update(new THREE.Vector3(.2, .1, 0)); f.pull.preview.tick(0);
  f.pull.abort();
  assert.equal(f.pull.preview.uniforms.pullEnabled.value, 0);
  assert.equal(f.volume.pulling, false); assert.equal(f.worker.terminated, true);
  f.worker.reply(f.response(f.pull.lastWarp, true));
  assert.equal(f.changes(), 0, 'A callback from a cancelled stroke cannot install a late shape');
});

test('A committed pull requests a complete surface replacement',t=>{
  const f=fixture(t);let replacements=0;
  f.volume.meshQueue={invalidate(){},remeshSurface(){replacements++;}};
  f.pull.update(new THREE.Vector3(.2,0,0));f.pull.finish();
  f.worker.reply(f.response(f.pull.lastWarp,true));assert.equal(replacements,1);
});

 test('A no-op release does not remesh the surface',t=>{
  const f=fixture(t);let replacements=0;
  f.volume.meshQueue={remeshSurface(){replacements++;}};
  f.pull.finish();f.worker.reply(f.response(f.pull.lastWarp,true));
  assert.equal(replacements,0);
});
