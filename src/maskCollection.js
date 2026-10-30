import { PendingMask } from './pendingMask.js';
import { maskCodec } from './maskCodec.js';
import { validateSavedMask } from './savedMask.js';

const emailKey=value=>(value ?? '').trim().toLowerCase();
export class MaskCollection {
  constructor({connect,pending=new PendingMask(),codec=maskCodec,onChange=()=>{},onSaved=()=>{},onSaveStarted=()=>{}}) {
    Object.assign(this,{connect,storage:pending,codec,onChange,onSaved,onSaveStarted});
    this.mode='register';this.rows=[];this.page=0;this.message='Save your mask to a collection you can open on any device.';
  }
  emit(){this.onChange(this);}
  initialize(){return this.initializing ??= this.start().catch(error=>{this.initializing=null;throw error;});}
  async start(){
    this.client=await this.connect();
    this.pending=await this.storage.get();
    const{data,error}=await this.client.auth.getSession();if(error)throw error;
    this.user=data.session?.user ?? null;
    this.client.auth.onAuthStateChange((event,session)=>setTimeout(()=>this.sessionChanged(event,session).catch(error=>this.fail(error)),0));
    if(this.user)this.mode='collection';this.emit();
    if(this.pending && this.canResume())await this.resume();
    return this;
  }
  canResume(){return Boolean(this.user && this.pending && (this.pending.ownerId ? this.pending.ownerId===this.user.id : this.pending.email && emailKey(this.pending.email)===emailKey(this.user.email)));}
  fail(error){this.message=error?.code==='40001'
    ? 'This mask was changed on another device. Save a new copy to keep both versions.'
    : error?.code==='PGRST202' || error?.code==='42P01'
      ? 'Online collections need one setup step. Ask the site owner to apply the saved-masks database setup. Your waiting mask is kept here.'
      : `${error.message ?? 'Saving is unavailable. Please retry.'}${this.pending ? ' Your waiting mask is kept on this device.' : ''}`;
    this.conflict=error?.code==='40001';this.emit();}
  async sessionChanged(event,session){
    const changed=this.user?.id!==session?.user.id;this.user=session?.user ?? null;
    if(changed){this.rows=[];this.page=0;this.mode=this.user?'collection':'login';}
    this.emit();
    if(event==='SIGNED_OUT')return;
    if(this.canResume() && !this.busy)await this.resume();
    else if(changed && this.user && !this.busy)await this.refresh();
  }
  async queue(record,{id,owner,revision=0,sourceToken}={}){
    if(this.pending)throw new Error('A mask is already waiting to save. Finish that save first.');
    if(!validateSavedMask(record))throw new Error('This mask could not be prepared for saving. Your stage mask is unchanged.');
    const own=this.user && owner===this.user.id;
    const pending={record,id:own?id:crypto.randomUUID(),revision:own?revision:0,sourceToken,
      requestId:crypto.randomUUID(),ownerId:this.user?.id ?? null,email:this.user?.email ?? null,createdAt:Date.now(),nameConfirmed:false};
    await this.storage.set(pending,{create:true});this.pending=pending;this.conflict=false;
    this.mode=this.user?'collection':'register';
    this.message=this.user?'Saving your mask…':'Create an account to save this mask. Already registered? Choose Sign in.';this.emit();
    if(this.user)await this.resume();
  }
  async authenticate(mode,email,password){
    if(this.busy)return;this.busy=true;this.message=mode==='register'?'Creating your account…':'Signing in…';this.emit();
    let session;
    try{
      await this.initialize();
      if(this.pending) {
        if(this.pending.ownerId && emailKey(this.pending.email)!==emailKey(email))throw new Error('Sign back into the account used for this waiting save, or discard the waiting copy.');
        this.pending={...this.pending,email:emailKey(email)};await this.storage.set(this.pending);
      }
      const result=mode==='register'
        ? await this.client.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:location.origin+location.pathname}})
        : await this.client.auth.signInWithPassword({email:email.trim(),password});
      if(result.error)throw result.error;session=result.data.session;
      if(session){this.user=session.user;this.mode='collection';}
      else {this.mode='confirm';this.message='Check your email to confirm your account, then sign in. Your mask is waiting safely on this device.';}
    }catch(error){this.fail(error);}
    finally{this.busy=false;this.emit();}
    if(session){if(this.canResume())await this.resume();else await this.refresh();}
  }
  async resume(){
    if(this.busy || !this.pending || !this.user)return false;
    if(!this.canResume()){this.message='This waiting mask belongs to another account. Sign into that account to finish saving it.';this.emit();return false;}
    if(!this.pending.nameConfirmed){this.mode='name';this.message='Give your mask a name, or keep its current name.';this.emit();return false;}
    this.busy=true;this.message='Saving your mask…';this.emit();
    try{
      this.onSaveStarted(this.pending);
      const pending={...this.pending,ownerId:this.user.id};await this.storage.set(pending);this.pending=pending;
      const payload=await this.codec('pack',pending.record);
      const{data:sessionData,error:sessionError}=await this.client.auth.getSession();
      if(sessionError || sessionData.session?.user.id!==pending.ownerId)throw new Error('Please sign in again to finish saving.');
      const{data,error}=await this.client.rpc('save_collection_mask',{
        mask_id:pending.id,expected_revision:pending.revision,save_request:pending.requestId,
        mask_name:pending.record.label,mask_shape:pending.record.shape,mask_color:pending.record.color,mask_payload:payload,
      }).abortSignal(AbortSignal.timeout(20000));
      if(error)throw error;
      await this.storage.clear(pending.requestId);this.pending=null;this.conflict=false;
      this.onSaved(pending,data);this.mode='collection';this.message='Saved to your collection. Yours to keep creating.';this.emit();
      await this.refresh({keepMessage:true});return true;
    }catch(error){this.fail(error);return false;}
    finally{this.busy=false;this.emit();}
  }
  async confirmName(value){
    if(this.busy || !this.pending || !this.canResume())return false;
    const label=typeof value==='string'?value.trim():'';
    if(!label || label.length>120)throw new Error('Enter a mask name between 1 and 120 characters.');
    const previousRequestId=this.pending.requestId;
    const pending={...this.pending,record:{...this.pending.record,label},nameConfirmed:true,
      requestId:label===this.pending.record.label?previousRequestId:crypto.randomUUID()};
    this.busy=true;this.emit();let stored=false;
    try{await this.storage.set(pending,{previousRequestId});this.pending=pending;this.mode='collection';stored=true;}
    catch(error){this.fail(error);}finally{this.busy=false;this.emit();}
    if(stored)return this.resume();return false;
  }
  async refresh({keepMessage=false}={}){
    if(!this.user||this.mode==='name')return;const owner=this.user.id;
    const{data,error}=await this.client.from('saved_masks').select('id,name,shape,color,revision,updated_at').eq('owner_id',owner)
      .order('updated_at',{ascending:false}).range(this.page*12,this.page*12+11).abortSignal(AbortSignal.timeout(15000));
    if(this.user?.id!==owner)return;
    if(error){if(keepMessage)this.message='Your mask was saved, but the collection could not refresh. Choose Refresh to try again.';else this.fail(error);}
    else{this.rows=data;this.hasNext=data.length===12;if(!keepMessage)this.message=this.pending?'A mask is waiting to save.':data.length?'Choose a mask to keep creating.':'Your collection is ready for its first mask.';}
    this.emit();
  }
  async read(id){
    const owner=this.user?.id;if(!owner)throw new Error('Sign in to open your masks.');
    const{data,error}=await this.client.from('saved_masks').select('id,owner_id,revision,payload').eq('id',id).eq('owner_id',owner).single().abortSignal(AbortSignal.timeout(15000));
    if(error)throw error;if(this.user?.id!==owner)throw new Error('Your account changed. Please open the collection again.');
    return {...data,record:await this.codec('unpack',data.payload)};
  }
  async saveCopy(){
    if(!this.pending || this.busy)return;
    const previousRequestId=this.pending.requestId;
    const copy={...this.pending,id:crypto.randomUUID(),revision:0,requestId:crypto.randomUUID()};
    await this.storage.set(copy,{previousRequestId});this.pending=copy;this.conflict=false;return this.resume();
  }
  async discard(){if(this.busy)return;await this.storage.clear(this.pending?.requestId);this.pending=null;this.conflict=false;this.message='Waiting save discarded. The mask on your stage is unchanged.';this.emit();}
  async signOut(){if(this.busy)return;const{error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;this.user=null;this.rows=[];this.mode='login';this.message='Signed out. Sign in to see your collection.';this.emit();}
}

export async function connectMaskCollection(url,key){
  if(!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_PUBLIC_KEY'))throw new Error('Online saving is not connected yet. Ask the site owner to add the Supabase project settings.');
  if(key.startsWith('sb_secret_'))throw new Error('Online saving needs the public publishable key.');
  if(key.startsWith('eyJ')){try{if(JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role!=='anon')throw new Error();}catch{throw new Error('Online saving needs the public publishable key.');}}
  const{createClient}=await import('@supabase/supabase-js');return createClient(url,key);
}
