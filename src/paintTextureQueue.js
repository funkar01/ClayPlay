// Keep one in-flight build and one replaceable latest request. Late paint
// results cannot overwrite a newer edit, Undo, reset, or disposed material.
export class PaintTextureQueue {
  constructor(onComplete,onError,{createWorker=()=>new Worker(new URL('./paintTextureWorker.js',import.meta.url),{type:'module'})}={}) {
    Object.assign(this,{onComplete,onError,createWorker});this.revision=0;
  }
  request(payload,context) {
    if(this.disposed)return;
    this.pending={id:++this.revision,payload,context};this.pump();
  }
  invalidate() {this.revision++;this.pending=null;}
  pump() {
    if(this.disposed || this.active || !this.pending)return;
    const job=this.pending;this.pending=null;this.active=job;
    try {
      const worker=this.worker ??=this.createWorker();
      worker.onmessage=({data})=>{
        if(this.disposed || this.worker!==worker || data.id!==this.active?.id)return;
        const completed=this.active;this.active=null;
        if(completed.id===this.revision) {
          if(data.error)this.onError(data.error);else this.onComplete(data,completed.context);
        }
        this.pump();
      };
      worker.onerror=event=>{if(this.worker===worker)this.fail(event.message || 'Paint texture worker failed');};
      worker.postMessage({id:job.id,...job.payload});
    } catch(error) {this.fail(error.message);}
  }
  fail(message) {
    this.worker?.terminate();this.worker=null;this.active=null;this.pending=null;
    if(!this.disposed)this.onError(message);
  }
  dispose() {this.disposed=true;this.invalidate();this.worker?.terminate();this.worker=null;this.active=null;}
}
