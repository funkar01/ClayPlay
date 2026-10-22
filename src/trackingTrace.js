// Local, bounded diagnostic history: timings and state only, never camera frames
// or landmarks. Preserve the first failure in a burst, before resets hide it.
export class TrackingTrace {
  constructor(limit=600,now=()=>performance.now()) {this.limit=limit;this.now=now;this.events=[];this.sequence=0;}
  record(event,details={}) {
    const entry={sequence:++this.sequence,at:Math.round(this.now()*10)/10,event,...details};
    this.events.push(entry);
    if(this.events.length>this.limit)this.events.shift();
    return entry;
  }
  incident(reason,details={}) {
    const entry=this.record('interruption',{reason,...details});
    if(!this.failure || entry.at-this.failure.at>1500)this.failure={...entry,before:this.events.slice()};
  }
  report() {return {failure:this.failure??null,recent:this.events.slice()};}
}
export const trackingTrace=new TrackingTrace();
