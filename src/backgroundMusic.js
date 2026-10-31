export function shuffledTracks(tracks, random = Math.random, last = null) {
  const bag=[...new Set(tracks)];
  for(let i=bag.length-1;i>0;i--) {
    const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];
  }
  if(bag.length>1 && bag[0]===last)[bag[0],bag[1]]=[bag[1],bag[0]];
  return bag;
}

// Native streaming/decoding, one element, no Web Audio buffers, animation-loop
// work or preloading of the playlist. Each shuffled round uses every track.
export class BackgroundMusic {
  constructor({ tracks=[], volume=.07, random=Math.random, createAudio=()=>new Audio(),
    storage=globalThis.localStorage, schedule=setTimeout, cancel=clearTimeout }={}) {
    Object.assign(this,{tracks:[...new Set(tracks)],volume,random,createAudio,storage,schedule,cancel});
    this.enabled=true;this.foreground=true;this.bag=[];this.failed=new Set();
    try {this.enabled=storage?.getItem('clayplay-music')!=='off';}catch{}
  }
  get canPlay() {return this.activated && this.enabled && this.foreground && !this.disposed;}
  activate() {this.activated=true;return this.resume();}
  async resume() {
    if(!this.canPlay || !this.tracks.length)return;
    if(this.request){this.resumeQueued=true;return;}
    if(!this.audio) {
      try {
        this.audio=this.createAudio();this.audio.preload='none';this.audio.loop=false;
        this.audio.volume=this.volume;
        this.audio.onended=()=>{this.next();this.resume();};
        this.audio.onerror=()=>this.skipFailed();
      }catch{this.audio=null;return;}
    }
    if(!this.current && !this.next())return;
    if(!this.audio.paused)return;
    try {
      const request=this.request=Promise.resolve(this.audio.play());
      try {await request;}finally{if(this.request===request)this.request=null;}
      if(!this.canPlay)this.audio?.pause();
    }catch(error) {
      // A browser policy block waits for the next real click. A broken file
      // is skipped, without retrying it indefinitely or stopping sculpting.
      if(error?.name==='NotSupportedError')this.skipFailed();
    }finally{
      const retry=this.resumeQueued;this.resumeQueued=false;
      if(retry && this.canPlay && this.audio?.paused)void this.resume();
    }
  }
  next() {
    if(this.disposed)return false;
    this.bag=this.bag.filter(track=>!this.failed.has(track));
    if(!this.bag.length)this.bag=shuffledTracks(this.tracks.filter(track=>!this.failed.has(track)),this.random,this.current);
    if(!this.bag.length){this.current=null;return false;}
    this.current=this.bag.shift();
    if(this.audio)this.audio.src=this.current;
    return true;
  }
  skipFailed() {
    if(this.disposed || !this.current)return;
    this.failed.add(this.current);this.audio?.pause();
    this.request=null;
    if(this.next())void this.resume();
  }
  pause() {this.audio?.pause();}
  setForeground(value) {this.foreground=value;if(value)void this.resume();else this.pause();}
  toggle() {
    this.enabled=!this.enabled;
    try{this.storage?.setItem('clayplay-music',this.enabled?'on':'off');}catch{}
    if(this.enabled)return this.activate();
    this.pause();
  }
  duck(duration=450) {
    if(!this.audio || !this.canPlay)return;
    this.cancel(this.duckTimer);this.audio.volume=this.volume*.35;
    this.duckTimer=this.schedule(()=>{this.duckTimer=null;if(this.audio)this.audio.volume=this.volume;},duration);
  }
  dispose() {
    this.disposed=true;this.cancel(this.duckTimer);this.pause();
    if(this.audio){this.audio.onended=null;this.audio.onerror=null;this.audio.removeAttribute('src');this.audio.load();}
    this.audio=null;this.bag=[];
  }
}
