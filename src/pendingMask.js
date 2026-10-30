// A durable save intent, never a password. It survives email confirmation and reload.
export class PendingMask {
  constructor(factory=globalThis.indexedDB){this.factory=factory;}
  async open(){
    if(this.db)return this.db;
    if(!this.factory)throw new Error('Saving is unavailable in this browser. Please allow site storage.');
    return new Promise((resolve,reject)=>{
      const request=this.factory.open('clayplay-mask-save',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'key'});
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Close other ClayPlay tabs and try again.'));
      request.onsuccess=()=>{this.db=request.result;this.db.onversionchange=()=>{this.db.close();this.db=null;};resolve(this.db);};
    });
  }
  async transact(mode,run){
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('pending',mode),request=run(tx.objectStore('pending'));
      tx.oncomplete=()=>resolve(request.result ?? null);tx.onabort=()=>reject(tx.error ?? new Error('Could not keep your mask on this device.'));
    });
  }
  get(){return this.transact('readonly',store=>store.get('save'));}
  async set(value,{create=false,previousRequestId=value.requestId}={}){
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),request=store.get('save');let error;
      request.onsuccess=()=>{
        if(request.result && (create || request.result.requestId!==previousRequestId)){
          error=new Error('Another tab has a mask waiting to save. Finish that save before starting another.');tx.abort();return;
        }
        try{store.put({...value,key:'save'});}catch(cause){error=cause;tx.abort();}
      };
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error ?? tx.error ?? new Error('Could not keep your waiting mask.'));
    });
  }
  async clear(requestId){
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),request=store.get('save');
      request.onsuccess=()=>{if(request.result?.requestId===requestId)store.delete('save');};
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });
  }
}
