// Presentation state only. Opening the dock never activates a tool.
export class DockVisibility {
  constructor({pinned=true,now=0,delay=1400}={}) {this.pinned=pinned;this.expanded=true;this.lastNear=now;this.delay=delay;}
  reveal(now) {this.expanded=true;this.lastNear=now;}
  update({now,near=false,hold=false,blocked=false}) {
    if(this.pinned || hold) {this.reveal(now);return true;}
    if(blocked)return this.expanded;
    if(near)this.reveal(now);
    else if(now-this.lastNear>=this.delay)this.expanded=false;
    return this.expanded;
  }
}
