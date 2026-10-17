import * as THREE from 'three';
import { taperedStroke } from './extrudeGeometry.js';
import { checkpoint } from './sculptHistory.js';

export class SurfaceExtrude {
  constructor(volume,onChange) { this.volume=volume; this.onChange=onChange; }
  begin(anchor,radius,symmetry) {
    const v=this.volume;
    if(v.pulling || v.cutting || v.meshQueue?.pending || radius<=0) return false;
    this.clear();
    v.meshQueue?.pauseRefinement?.();
    this.radius=Math.min(.16,Math.max(.04,radius*.4)); this.symmetry=symmetry;
    // Embed the attachment slightly into the existing shell, keeping the root flush.
    this.points=[anchor.clone().add(new THREE.Vector3(0,0,-this.radius*.55))]; this.active=true;
    this.preview=new THREE.Group(); v.parent.add(this.preview);
    v.pulling=true;
    return true;
  }
  update(point) {
    if(!this.active) return;
    if(![point.x,point.y,point.z].every(Number.isFinite)) return;
    const p=point.clone();
    if(p.distanceTo(this.points.at(-1))<.002) return;
    // Keep a live endpoint even below the control-point spacing, so gentle
    // movements remain visible and the last held position survives release.
    if(this.points.length>1 && p.distanceTo(this.points.at(-2))<.012) this.points[this.points.length-1]=p;
    else
    this.points.push(p);
    // Keep a bounded path and preserve the newest curve rather than a backlog.
    if(this.points.length>128) {
      let index=1,error=Infinity;
      for(let i=1;i<this.points.length-1;i++) {
        const a=this.points[i-1],b=this.points[i],c=this.points[i+1];
        const segment=c.clone().sub(a), t=THREE.MathUtils.clamp(b.clone().sub(a).dot(segment)/(segment.lengthSq()||1),0,1);
        const d=b.distanceTo(a.clone().addScaledVector(segment,t));
        if(d<error) {error=d;index=i;}
      }
      this.points.splice(index,1);
    }
    const curve=new THREE.CatmullRomCurve3(this.points,false,'centripetal');
    const segments=Math.min(192,Math.max(24,Math.ceil(curve.getLength()/.018)));
    for(const child of [...this.preview.children]) { child.geometry.dispose(); this.preview.remove(child); }
    const sides=32;
    const geometry=new THREE.TubeGeometry(curve,segments,1,sides,false);
    const positions=geometry.attributes.position;
    // TubeGeometry uses arc-length sampling; use those same centers for the
    // preview and authoritative tapered field.
    const centers=curve.getSpacedPoints(segments);
    this.stroke=taperedStroke(centers.map(p=>p.toArray()),this.radius,this.symmetry,false);
    for(let i=0;i<centers.length;i++) for(let j=0;j<=sides;j++) {
      const index=i*(sides+1)+j,center=centers[i];
      positions.setXYZ(index,center.x+(positions.getX(index)-center.x)*this.stroke.radii[i],center.y+(positions.getY(index)-center.y)*this.stroke.radii[i],center.z+(positions.getZ(index)-center.z)*this.stroke.radii[i]);
    }
    geometry.computeVertexNormals();
    // Share normals at the duplicate UV seam to avoid a visible shading stripe.
    const normals=geometry.attributes.normal;
    for(let i=0;i<centers.length;i++) {
      const first=i*(sides+1),last=first+sides;
      const n=new THREE.Vector3().fromBufferAttribute(normals,first).add(new THREE.Vector3().fromBufferAttribute(normals,last)).normalize();
      normals.setXYZ(first,n.x,n.y,n.z);normals.setXYZ(last,n.x,n.y,n.z);
    }
    const add=mesh=>{mesh.geometry.setAttribute('paintColor',new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count*4),4));this.preview.add(mesh);if(this.symmetry){const twin=mesh.clone();twin.position.x*=-1;twin.scale.x=-1;this.preview.add(twin);}};
    add(new THREE.Mesh(geometry,this.volume.material));
    for(const i of [centers.length-1]) {
      const cap=new THREE.Mesh(new THREE.SphereGeometry(this.stroke.radii[i],32,20),this.volume.material);
      cap.position.copy(centers[i]); add(cap);
    }
  }
  finish() {
    if(!this.active) return;
    const v=this.volume;
    this.active=false; v.pulling=false;
    if(this.stroke) {
      this.stroke=taperedStroke(this.stroke.points,this.radius,this.symmetry);
      checkpoint(v);
      v.extrudeSource=v.snapshot(); v.extrusion=this.stroke;
      v.pullSource=null; v.pullWarp=null; v.cutSource=null; v.cutRegion=null; v.field.clear();
      v.paint=new Map();
      this.committing=true;
      v.meshQueue?.reset();
      // Union changes only cells near the new path; keep the rest of the mask.
      const paths=[this.stroke.points];
      if(this.symmetry) paths.push(this.stroke.points.map(p=>[-p[0],p[1],p[2]]));
      const keys=new Set(), cell=.6, padding=this.radius+.05;
      for(const path of paths) for(let i=1;i<path.length;i++) {
        const points=[path[i-1],path[i]];
        const low=[0,1,2].map(a=>Math.floor((Math.min(...points.map(p=>p[a]))-padding+2.4)/cell));
        const high=[0,1,2].map(a=>Math.floor((Math.max(...points.map(p=>p[a]))+padding+2.4)/cell));
        for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++)keys.add(`${x},${y},${z}`);
      }
      for(const key of keys) v.rebuildBrick(...key.split(',').map(Number));
      this.onChange();
      // Keep the preview until the generated surface has replaced it.
      const wait=()=>{if(v.meshQueue?.pending) this.timer=setTimeout(wait,40); else this.clear();};
      wait();
    } else this.clear();
    document.dispatchEvent(new Event('sculpt-history-change'));
  }
  clear() {
    clearTimeout(this.timer);
    if(this.preview) {this.volume.parent.remove(this.preview); for(const child of this.preview.children) child.geometry.dispose();}
    this.preview=null; this.stroke=null; this.committing=false;
    this.volume.meshQueue?.resumeRefinement?.();
  }
  abort() {this.active=false;this.volume.pulling=false;this.clear();}
}
