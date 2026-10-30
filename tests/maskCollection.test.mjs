import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MaskCollection} from '../src/maskCollection.js';
import {ClayVolume} from '../src/clayVolume.js';
import {captureSavedMask,validateSavedMask,restoreSavedMask} from '../src/savedMask.js';
import {packMask,unpackMask} from '../src/maskCodec.js';

function record(){return {version:1,label:'My painted mask',shape:'full',color:'#cd6e45',roughness:.4,scale:1.3,offset:[.1,-.2],
  state:{shape:'full',eyeShape:'oval',field:[['0,0,0',.2]],paint:[['0,0,0',[.2,.1,.05,1]]],paintCell:.04},
  bricks:[{key:'0,0,0',positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1])}]};}
class MemoryPending{
  async get(){return structuredClone(this.value ?? null);}
  async set(value){if(this.fail)throw new Error('Device storage is full');this.value=structuredClone(value);}
  async clear(id){if(this.value?.requestId===id)this.value=null;}
}
const owner={id:'owner',email:'mask@example.test'},other={id:'other',email:'other@example.test'};
function fixture({user=null,pending=new MemoryPending(),confirm=false}={}){
  const saved=[],authCalls=[],auth={
    getSession:async()=>({data:{session:user?{user}:null}}),onAuthStateChange:callback=>{auth.callback=callback;},
    signUp:async data=>{authCalls.push(data);if(confirm)return {data:{session:null,user:owner}};user=owner;return {data:{session:{user}}};},
    signInWithPassword:async data=>{authCalls.push(data);if(data.password==='wrong')return{error:new Error('Invalid email or password')};user=owner;return{data:{session:{user}}};},
    signOut:async()=>{user=null;return{};},
  };
  const client={auth,rpc:(_name,data)=>({abortSignal:async()=>{saved.push(data);return client.failure?{error:client.failure}:{data:{id:data.mask_id,revision:data.expected_revision+1}};}})};
  const changes=[],m=new MaskCollection({connect:async()=>client,pending,codec:async(_operation,data)=>data,onChange:()=>changes.push(m.message)});
  m.refresh=async()=>{};
  return {m,pending,saved,authCalls,client,changes};
}
test('Saved mask captures exact geometry, editable field, paint, finish and pose',async()=>{
  const source=record(),item={group:new THREE.Group(),material:new THREE.MeshPhysicalMaterial({color:source.color}),volume:ClayVolume.fromState(source.state)};
  item.volume.bricks=new Map();item.volume.parent=item.group;item.volume.material=item.material;
  restoreSavedMask(item,source);const restored=captureSavedMask({...item,label:item.label});
  assert.deepEqual({...restored,state:JSON.parse(JSON.stringify(restored.state))},source);assert.equal(typeof item.volume.sample,'function');assert.equal(validateSavedMask(restored),true);
  const packed=await packMask(restored);assert.deepEqual(await unpackMask(packed),source);
  await assert.rejects(unpackMask({...packed,version:9}));
});
test('Unsupported or damaged mask records are rejected, while a fully erased mask is valid',()=>{
  const valid=record();assert.equal(validateSavedMask({...valid,version:2}),false);assert.equal(validateSavedMask({...valid,scale:Infinity}),false);
  valid.bricks[0].positions[0]=NaN;assert.equal(validateSavedMask(valid),false);assert.equal(validateSavedMask({...record(),bricks:[]}),true);
});
test('Guest Save persists the snapshot before asking for registration',async()=>{
  const {m,pending,saved}=fixture();await m.initialize();await m.queue(record(),{sourceToken:'local-mask'});
  assert.equal(m.mode,'register');assert.deepEqual(pending.value.record,record());assert.equal(saved.length,0);assert.equal(pending.value.ownerId,null);
});
test('An existing session saves directly and repeated Save updates the same owned record',async()=>{
  const {m,saved,pending}=fixture({user:owner});await m.initialize();
  await m.queue(record(),{id:'existing',owner:owner.id,revision:4});assert.equal(saved.length,1);assert.equal(saved[0].mask_id,'existing');
  assert.equal(saved[0].expected_revision,4);assert.equal(pending.value,null);assert.match(m.message,/Saved/);
});
test('Opening another account’s local mask creates a new collection copy',async()=>{
  const {m,saved}=fixture({user:other});await m.initialize();await m.queue(record(),{id:'foreign',owner:owner.id,revision:8});
  assert.notEqual(saved[0].mask_id,'foreign');assert.equal(saved[0].expected_revision,0);
});
test('Registration awaiting email confirmation keeps the mask across restart; login resumes it',async t=>{
  const previous=globalThis.location;globalThis.location={origin:'https://clayplay.test',pathname:'/'};t.after(()=>{globalThis.location=previous;});
  const {m,pending,saved}=fixture({confirm:true});await m.initialize();await m.queue(record());await m.authenticate('register',owner.email,'example-password');
  assert.equal(m.mode,'confirm');assert.equal(saved.length,0);assert.equal(pending.value.email,owner.email);
  assert.equal(JSON.stringify(pending.value).includes('example-password'),false);
  const reopened=fixture({user:owner,pending});await reopened.m.initialize();assert.equal(reopened.saved.length,1);assert.equal(pending.value,null);
});
test('Failed login keeps the draft, and a later correct password saves it',async()=>{
  const {m,pending,saved}=fixture();await m.initialize();await m.queue(record());
  await m.authenticate('login',owner.email,'wrong');assert.ok(pending.value);assert.equal(saved.length,0);assert.match(m.message,/Invalid/);
  await m.authenticate('login',owner.email,'correct-password');assert.equal(saved.length,1);assert.equal(pending.value,null);
});
test('A different signed-in account cannot auto-upload a pending mask on restart',async()=>{
  const first=fixture();await first.m.initialize();await first.m.queue(record());first.pending.value.email=owner.email;
  const next=fixture({user:other,pending:first.pending});await next.m.initialize();assert.equal(next.saved.length,0);assert.ok(next.pending.value);
});
test('Network failure retains the request ID and retry does not create a second logical mask',async()=>{
  const {m,client,saved,pending}=fixture({user:owner});await m.initialize();client.failure=new Error('Offline');
  await m.queue(record());const id=pending.value.id,request=pending.value.requestId;assert.ok(pending.value);
  client.failure=null;await m.resume();assert.equal(saved.length,2);assert.equal(saved[1].mask_id,id);assert.equal(saved[1].save_request,request);assert.equal(pending.value,null);
});
test('Conflicting revisions retain the waiting mask and Save a copy uses a fresh ID',async()=>{
  const {m,client,saved}=fixture({user:owner});await m.initialize();client.failure={code:'40001',message:'Changed'};
  await m.queue(record(),{id:'old',owner:owner.id,revision:2});assert.equal(m.conflict,true);assert.ok(m.pending);
  client.failure=null;await m.saveCopy();assert.notEqual(saved[1].mask_id,'old');assert.equal(saved[1].expected_revision,0);
});
test('Storage failure cannot claim success or start an upload',async()=>{
  const {m,pending,saved}=fixture({user:owner});await m.initialize();pending.fail=true;
  await assert.rejects(m.queue(record()),/storage is full/);assert.equal(saved.length,0);assert.equal(m.pending,null);
});
test('A damaged mask cannot replace a waiting save or start a network upload',async()=>{
  const {m,saved,pending}=fixture({user:owner});await m.initialize();
  await assert.rejects(m.queue({...record(),scale:NaN}),/could not be prepared/);assert.equal(saved.length,0);assert.equal(pending.value,undefined);
});
test('Signing out immediately clears the displayed account collection',async()=>{
  const {m}=fixture({user:owner});await m.initialize();m.rows=[{id:'private'}];await m.signOut();assert.equal(m.user,null);assert.deepEqual(m.rows,[]);
});
