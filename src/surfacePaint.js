import * as THREE from 'three';
import { paintSegment,refreshPaint } from './paintLayer.js';
import { checkpointPaint } from './sculptHistory.js';

export class SurfacePaint {
  constructor(volume,onChange){this.volume=volume;this.onChange=onChange;}
  begin(radius,color,symmetry=false) {
    if(radius<=0 || this.volume.pulling || this.volume.cutting || this.volume.meshQueue?.pending)return false;
    this.volume.meshQueue?.pauseRefinement?.();
    this.radius=Math.max(.04,Math.min(.5,radius));this.color=new THREE.Color(color);this.symmetry=symmetry;
    this.changes=new Map();this.coverage=new Map();this.bases=new Map();this.pending=[];this.segments=[];this.last=null;this.active=true;return true;
  }
  update(point,normal) {
    if(!this.active)return;
    if(this.last && this.last.distanceToSquared(point)<.000009)return;
    this.pending.push({point:point.clone(),normal:normal.clone(),start:!this.last});
    this.last=point.clone();
  }
  breakPath(){this.last=null;}
  tick() {
    if(!this.pending?.length)return;
    const bounds=new THREE.Box3();
    for(const {point,normal,start}of this.pending) {
      const a=start ? point : this.applied ?? point;
      const fromNormal=start ? normal : this.appliedNormal ?? normal;
      bounds.union(paintSegment(this.volume,a,point,normal,this.radius,this.color,this.changes,this.coverage,this.bases,fromNormal));
      if(this.symmetry) {
        const mirror=p=>new THREE.Vector3(-p.x,p.y,p.z);
        bounds.union(paintSegment(this.volume,mirror(a),mirror(point),mirror(normal),this.radius,this.color,this.changes,this.coverage,this.bases,mirror(fromNormal)));
      }
      this.segments.push([a.toArray(),point.toArray()]);
      this.applied=point;
      this.appliedNormal=normal;
    }
    this.pending=[];refreshPaint(this.volume,bounds);
  }
  finish() {
    if(!this.active)return;
    this.tick();const lastPoint=this.applied?.clone();this.active=false;this.last=null;this.applied=null;this.appliedNormal=null;
    // Preserve the whole committed path for tutorial scoring, including gaps.
    // The final point alone can be outside a correctly painted target.
    const stroke={segments:this.segments,radius:this.radius,symmetry:this.symmetry};this.segments=null;
    if(this.changes.size){checkpointPaint(this.volume,this.changes);this.onChange(lastPoint,stroke);}
    this.coverage.clear();this.bases.clear();this.changes.clear();
    this.volume.meshQueue?.resumeRefinement?.();
  }
}
