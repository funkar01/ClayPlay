import { HandMotion } from './handMotion.js';

const clamp=v=>Math.max(0,Math.min(1,v));
// Use the wrist and finger bases, never the bounding box or fingertip cluster.
export function palmPosture(points,aspect=1) {
  if(!points || points.length<21 || points.some(p=>!['x','y','z'].every(k=>Number.isFinite(p[k]))))return null;
  const ids=[0,5,9,13,17];
  if(ids.some(i=>points[i].x<.015 || points[i].x>.985 || points[i].y<.015 || points[i].y>.985))return null;
  const center={x:0,y:0,z:0};
  for(const i of ids)for(const k of ['x','y','z'])center[k]+=points[i][k]/ids.length;
  const d=(a,b)=>Math.hypot((points[a].x-points[b].x)*aspect,points[a].y-points[b].y);
  const width=d(5,17),length=d(0,9),scale=Math.max(width,length);
  if(scale<.04 || length<.025)return null;
  const area=Math.abs((points[5].x-points[0].x)*aspect*(points[17].y-points[0].y)-(points[17].x-points[0].x)*aspect*(points[5].y-points[0].y));
  if(area/(scale*scale)<.08)return null;
  let curled=0,extended=0;
  for(const [base,joint,tip]of [[5,6,8],[9,10,12],[13,14,16],[17,18,20]]) {
    const a=points[base],b=points[joint],c=points[tip];
    const u=[(a.x-b.x)*aspect,a.y-b.y,(a.z-b.z)*aspect];
    const v=[(c.x-b.x)*aspect,c.y-b.y,(c.z-b.z)*aspect];
    const cosine=u.reduce((sum,n,i)=>sum+n*v[i],0)/(Math.hypot(...u)*Math.hypot(...v)||1);
    if(d(tip,0)<d(joint,0)*.98 || cosine>-.2)curled++;
    if(d(tip,0)>d(joint,0)*1.08 && cosine<-.55)extended++;
  }
  return {center,scale,open:extended>=3,opening:extended>=2,closed:curled>=3};
}

export class PalmControl {
  constructor(){this.motion=new HandMotion({minCutoff:2.2,beta:12,maxPredictionMs:0,staleMs:250});this.reset();}
  reset(){this.held=false;this.armed=false;this.openAt=null;this.closeAt=null;this.uncertainAt=null;this.last=null;this.offset={x:0,y:0};this.time=null;this.raw=null;this.motion.reset();}
  lose(){this.reset();return {valid:false,held:false,open:false,phase:'lost',point:null};}
  update(points,now,aspect=1) {
    if(this.time!==null && now-this.time>250)this.reset();
    const posture=palmPosture(points,aspect);
    if(!posture)return this.lose();
    const raw=posture.center;
    if(this.raw && this.time!==null && now-this.time<120 && Math.hypot((raw.x-this.raw.x)*aspect,raw.y-this.raw.y)>posture.scale*1.1)return this.lose();
    this.raw={...raw};this.time=now;
    // Inner 70% of the view reaches the workspace edges without clipping fingers.
    const measured={x:clamp((raw.x-.15)/.7),y:clamp((raw.y-.15)/.7),z:0};
    const filtered=this.motion.update([measured],now)[0];
    if(posture.opening) {
      const releasing=this.held;
      this.held=false;this.closeAt=null;this.uncertainAt=null;
      if(releasing){this.armed=false;this.openAt=null;}
      if(posture.open){this.openAt??=now;if(now-this.openAt>=80)this.armed=true;}
      else this.openAt=null;
      // Keep the same coordinate offset through release, avoiding a cursor jump.
      this.last={x:clamp(filtered.x+this.offset.x),y:clamp(filtered.y+this.offset.y),z:0};
      return {valid:true,held:false,open:posture.open,phase:releasing?'released':this.armed?'ready':'open-first',point:this.last};
    }
    this.openAt=null;
    if(!this.armed) {this.last={...filtered};return {valid:true,held:false,open:false,phase:'open-first',point:this.last};}
    if(posture.closed) {
      this.uncertainAt=null;
      if(!this.held) {
        this.closeAt??=now;
        if(now-this.closeAt<100)return {valid:true,held:false,open:false,phase:'closing',point:this.last??filtered};
        const anchor=this.last??filtered;
        this.offset={x:anchor.x-filtered.x,y:anchor.y-filtered.y};this.held=true;
      }
      this.last={x:clamp(filtered.x+this.offset.x),y:clamp(filtered.y+this.offset.y),z:0};
      return {valid:true,held:true,open:false,phase:'holding',point:this.last};
    }
    this.closeAt=null;this.uncertainAt??=now;
    if(this.held && now-this.uncertainAt>120)return this.lose();
    return {valid:false,held:this.held,open:false,phase:'uncertain',point:this.last};
  }
}
