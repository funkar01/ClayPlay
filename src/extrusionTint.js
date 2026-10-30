import * as THREE from 'three';
import { inverseWarp } from './maskWarp.js';
import { extrusionDistance } from './extrudeGeometry.js';

// Tint is stroke metadata, separate from pixel paint. Building an extrusion
// never allocates a 3D paint texture or fills a voxel volume with pigment.
export function extrusionTintSampler(volume) {
  if (!volume) return null;
  if (volume.pullSource) {
    const sample = extrusionTintSampler(volume.pullSource);
    return sample && ((x,y,z)=>sample(...inverseWarp(x,y,z,volume.pullWarp)));
  }
  if (volume.cutSource) return extrusionTintSampler(volume.cutSource);
  if (!volume.extrudeSource) return null;
  const inherited = extrusionTintSampler(volume.extrudeSource), stroke = volume.extrusion;
  if (!stroke?.color) return inherited;
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  const padding=Math.max(...stroke.radii)+.04;
  for(const point of stroke.points)for(let a=0;a<3;a++) {
    low[a]=Math.min(low[a],point[a]-padding);high[a]=Math.max(high[a],point[a]+padding);
    if(a===0 && stroke.symmetry){low[a]=Math.min(low[a],-point[a]-padding);high[a]=Math.max(high[a],-point[a]+padding);}
  }
  return (x,y,z)=>{
    if(x>=low[0] && x<=high[0] && y>=low[1] && y<=high[1] && z>=low[2] && z<=high[2]
      && extrusionDistance(x,y,z,stroke,.04)<.04 && volume.extrudeSource.sample(x,y,z)>0) return [...stroke.color,1];
    return inherited?.(x,y,z) ?? [0,0,0,0];
  };
}

export function applyExtrusionTint(volume,geometry) {
  if(geometry.getAttribute('extrudeColor')?.count===geometry.attributes.position.count)return;
  const sample=extrusionTintSampler(volume);
  if(!sample)return;
  const positions=geometry.attributes.position,colors=new Float32Array(positions.count*4),cache=new Map();
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),key=`${x},${y},${z}`;
    let color=cache.get(key);
    if(!color){color=sample(x,y,z);cache.set(key,color);}
    colors.set(color,i*4);
  }
  geometry.setAttribute('extrudeColor',new THREE.BufferAttribute(colors,4));
}
