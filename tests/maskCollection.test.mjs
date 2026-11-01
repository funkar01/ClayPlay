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
test('Sharing sends the saved mask ID and normalized friend email',async()=>{
 const {m,client}=fixture({user:owner});await m.initialize();let call;
 client.rpc=(name,args)=>({abortSignal:async()=>{call={name,args};return{data:'share-id'};}});
 assert.equal(await m.share('saved-mask','  FRIEND@example.test  '),true);
 assert.deepEqual(call,{name:'share_collection_mask',args:{mask_id:'saved-mask',friend_email:'friend@example.test'}});
});
test('Sharing rejects self, invalid addresses and resharing a received mask',async()=>{
 const {m,saved}=fixture({user:owner});await m.initialize();
 await assert.rejects(m.share('mask',owner.email));await assert.rejects(m.share('mask','invalid'));
 m.category='shared';await assert.rejects(m.share('mask',other.email));assert.equal(saved.length,0);
});
test('Failed sharing reports failure without claiming delivery',async()=>{
 const {m,client}=fixture({user:owner});await m.initialize();client.failure=new Error('Offline');
 assert.equal(await m.share('mask',other.email),false);assert.match(m.message,/Could not share/);
});
test('Deletion removes the selected collection entry only after server confirmation',async()=>{
  const {m,client}=fixture({user:owner});await m.initialize();m.rows=[{id:'one',revision:3},{id:'two',revision:1}];
  client.rpc=(name,args)=>({abortSignal:async()=>{assert.equal(name,'delete_collection_mask');assert.deepEqual(args,{mask_id:'one',expected_revision:3});return{data:true};}});
  assert.equal(await m.remove('one'),true);assert.deepEqual(m.rows.map(row=>row.id),['two']);
});
test('Failed deletion retains the mask and reports an error',async()=>{
  const {m,client}=fixture({user:owner});await m.initialize();m.rows=[{id:'one',revision:3}];
  client.rpc=()=>({abortSignal:async()=>({error:new Error('Offline')})});
  assert.equal(await m.remove('one'),false);assert.equal(m.rows.length,1);assert.match(m.message,/Could not delete/);
});
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

test('Unveiling starts after authentication and before packing or upload completes',async()=>{
  const {m,saved}=fixture();await m.initialize();const started=[];
  m.onSaveStarted=pending=>started.push(pending.requestId);
  await m.queue(record());assert.equal(started.length,0);
  let release;const packing=new Promise(resolve=>{release=resolve;});
  m.codec=async(_operation,data)=>{await packing;return data;};
  const signingIn=m.authenticate('login',owner.email,'correct-password');
  await signingIn;assert.equal(m.mode,'name');assert.equal(started.length,0);
  const naming=m.confirmName('My revealed mask');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(started.length,1);assert.equal(m.busy,true);assert.equal(saved.length,0);
  release();await naming;assert.equal(saved.length,1);assert.equal(saved[0].mask_name,'My revealed mask');
});
test('An existing session can rename a mask before updating the same owned record',async()=>{
  const {m,saved,pending}=fixture({user:owner});await m.initialize();
  await m.queue(record(),{id:'existing',owner:owner.id,revision:4});assert.equal(saved.length,0);assert.equal(m.mode,'name');
  await m.confirmName('  Moonlight  ');assert.equal(saved.length,1);assert.equal(saved[0].mask_id,'existing');
  assert.equal(saved[0].mask_name,'Moonlight');assert.equal(saved[0].mask_payload.label,'Moonlight');
  assert.equal(saved[0].expected_revision,4);assert.equal(pending.value,null);assert.match(m.message,/Saved/);
});
test('Opening another account’s local mask creates a new collection copy',async()=>{
  const {m,saved}=fixture({user:other});await m.initialize();await m.queue(record(),{id:'foreign',owner:owner.id,revision:8});
  await m.confirmName(m.pending.record.label);
  assert.notEqual(saved[0].mask_id,'foreign');assert.equal(saved[0].expected_revision,0);
});
test('Registration awaiting email confirmation keeps the mask across restart; login resumes it',async t=>{
  const previous=globalThis.location;globalThis.location={origin:'https://clayplay.test',pathname:'/'};t.after(()=>{globalThis.location=previous;});
  const {m,pending,saved}=fixture({confirm:true});await m.initialize();await m.queue(record());await m.authenticate('register',owner.email,'example-password');
  assert.equal(m.mode,'confirm');assert.equal(saved.length,0);assert.equal(pending.value.email,owner.email);
  assert.equal(JSON.stringify(pending.value).includes('example-password'),false);
  const reopened=fixture({user:owner,pending});await reopened.m.initialize();assert.equal(reopened.saved.length,0);assert.equal(reopened.m.mode,'name');
  await reopened.m.confirmName('Confirmed creation');assert.equal(reopened.saved.length,1);assert.equal(pending.value,null);
});
test('Failed login keeps the draft, and a later correct password saves it',async()=>{
  const {m,pending,saved}=fixture();await m.initialize();await m.queue(record());
  await m.authenticate('login',owner.email,'wrong');assert.ok(pending.value);assert.equal(saved.length,0);assert.match(m.message,/Invalid/);
  await m.authenticate('login',owner.email,'correct-password');assert.equal(saved.length,0);assert.equal(m.mode,'name');
  await m.confirmName(m.pending.record.label);assert.equal(saved.length,1);assert.equal(pending.value,null);
});
test('A different signed-in account cannot auto-upload a pending mask on restart',async()=>{
  const first=fixture();await first.m.initialize();await first.m.queue(record());first.pending.value.email=owner.email;
  const next=fixture({user:other,pending:first.pending});await next.m.initialize();assert.equal(next.saved.length,0);assert.ok(next.pending.value);
});
test('Network failure retains the request ID and retry does not create a second logical mask',async()=>{
  const {m,client,saved,pending}=fixture({user:owner});await m.initialize();client.failure=new Error('Offline');
  await m.queue(record());await m.confirmName(m.pending.record.label);const id=pending.value.id,request=pending.value.requestId;assert.ok(pending.value);
  client.failure=null;await m.resume();assert.equal(saved.length,2);assert.equal(saved[1].mask_id,id);assert.equal(saved[1].save_request,request);assert.equal(pending.value,null);
});
test('Conflicting revisions retain the waiting mask and Save a copy uses a fresh ID',async()=>{
  const {m,client,saved}=fixture({user:owner});await m.initialize();client.failure={code:'40001',message:'Changed'};
  await m.queue(record(),{id:'old',owner:owner.id,revision:2});await m.confirmName(m.pending.record.label);assert.equal(m.conflict,true);assert.ok(m.pending);
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

test('Empty or overlong names keep the naming step open without starting a save',async()=>{
  const {m,saved,pending}=fixture({user:owner});await m.initialize();await m.queue(record());
  for(const name of ['   ','x'.repeat(121)])await assert.rejects(m.confirmName(name),/1 and 120/);
  assert.equal(m.mode,'name');assert.equal(saved.length,0);assert.equal(pending.value.nameConfirmed,false);
});
test('A confirmed name survives upload failure and reload without prompting again',async()=>{
  const first=fixture({user:owner});await first.m.initialize();first.client.failure=new Error('Offline');
  await first.m.queue(record());await first.m.confirmName('Silver Fox');
  assert.equal(first.pending.value.nameConfirmed,true);assert.equal(first.pending.value.record.label,'Silver Fox');
  const reopened=fixture({user:owner,pending:first.pending});await reopened.m.initialize();
  assert.equal(reopened.saved.length,1);assert.equal(reopened.saved[0].mask_name,'Silver Fox');
});

test('Received try-on masks cannot be captured for saving as editable copies',()=>{
  assert.throws(()=>captureSavedMask({readOnly:true}),/try-on and selfies only/);
});

test('Public links open a read-only preview without a signed-in recipient',async()=>{
  const {m,client}=fixture();const token='3eb9c436-d830-4184-87de-eae691f80861';let calls=0;
  client.rpc=(name,args)=>({abortSignal:async()=>{calls++;assert.equal(name,'open_mask_share_link');assert.equal(args.link_token,token);return{data:record()};}});
  const result=await m.openShareLink(token);
  assert.equal(m.user,undefined);assert.equal(result.readOnly,true);assert.equal(result.previewOnly,true);assert.equal(result.record.label,'My painted mask');
  await assert.rejects(m.openShareLink('invalid'),/invalid/);assert.equal(calls,1);
});
test('Share links point at the studio and exclude existing URL parameters',async()=>{
  const {m,client}=fixture({user:owner});await m.initialize();const token='3eb9c436-d830-4184-87de-eae691f80861';
  client.rpc=(name,args)=>({abortSignal:async()=>{assert.equal(name,'create_mask_share_link');assert.equal(args.mask_id,'mine');return{data:token};}});
  assert.equal(await m.createShareLink('mine','https://example.test/studio/?private=value#old'),`https://example.test/studio/#mask=${token}`);
  m.category='shared';await assert.rejects(m.createShareLink('received','https://example.test/'),/own saved masks/);
});
test('Missing and damaged link snapshots report an error',async()=>{
  const {m,client}=fixture();const token='3eb9c436-d830-4184-87de-eae691f80861';
  client.rpc=()=>({abortSignal:async()=>({data:null})});await assert.rejects(m.openShareLink(token),/no longer available/);
  client.rpc=()=>({abortSignal:async()=>({data:{version:999}})});await assert.rejects(m.openShareLink(token),/could not be opened/);
});
