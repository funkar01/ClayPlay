import { surfaceBrickKeys } from './surfaceBricks.js';

// Cosmetic/regularizing work is separate from authoritative edit commits.
// The complete current mesh remains editable until an entire new revision exists.
export class SurfaceCleanup {
  constructor(volume, install, isBusy, {delay=180, createWorker=()=>new Worker(new URL('./meshWorker.js',import.meta.url),{type:'module'})}={}) {
    Object.assign(this,{volume,install,isBusy,delay,createWorker});this.epoch=0;this.needed=false;
  }
  get pending(){return this.needed;}
  request(){this.cancel();this.needed=true;this.resume();}
  pause() {
    clearTimeout(this.timer);this.timer=null;this.epoch++;
    if(this.running){this.worker?.terminate();this.worker=null;}
    this.running=false;this.keys=null;this.staged=null;
  }
  cancel(){this.pause();this.needed=false;}
  resume() {
    if(!this.needed || this.timer || this.running)return;
    this.timer=setTimeout(()=>{
      this.timer=null;
      try {this.start();}catch(error){this.stopAfterError(error.message);}
    },this.delay);
  }
  start() {
    if(!this.needed)return;
    if(this.isBusy()){this.resume();return;}
    const epoch=this.epoch,volume=this.volume;
    const worker=this.worker ??=this.createWorker();
    this.keys=[...surfaceBrickKeys(volume.bricks)];this.staged=new Map();this.running=true;
    worker.onmessage=({data})=>{
      if(this.worker!==worker || this.epoch!==epoch || !this.running)return;
      if(data.generation!==epoch)return;
      if(data.error){this.stopAfterError(data.error);return;}
      for(const brick of data.bricks)this.staged.set(brick.key,brick);
      if(this.isBusy()){this.pause();return;}
      if(this.keys.length){this.send(epoch,false);return;}
      // Synchronous publication means raycasts never see half of a revision.
      for(const brick of this.staged.values())this.install(brick);
      this.staged=null;this.running=false;this.needed=false;
      // Keep the worker warm, but release its serialized field and node cache.
      worker.postMessage({id:1,remove:true});
    };
    worker.onerror=event=>{if(this.worker===worker && this.epoch===epoch)this.stopAfterError(event.message);};
    this.send(epoch,true);
  }
  send(epoch,reset) {
    const keys=this.keys.splice(0,2);
    if(!keys.length){this.running=false;this.needed=false;return;}
    this.worker.postMessage({id:1,generation:epoch,shape:this.volume.shape,state:reset?this.volume.serialize():undefined,keys,edits:[],reset,step:1});
  }
  stopAfterError(message) {
    // The saved field and visible mesh are already valid. Optional cleanup
    // failure must not disable tools or erase a completed deformation.
    console.warn('Surface cleanup skipped:',message);this.cancel();
    this.worker?.terminate();this.worker=null;
  }
  dispose(){this.cancel();this.worker?.terminate();this.worker=null;}
}
