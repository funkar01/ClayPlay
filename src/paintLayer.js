import * as THREE from 'three';
import { inverseWarp } from './maskWarp.js';

export const PAINT_CELL=.04;
const empty=[0,0,0,0];
const key=(x,y,z)=>`${x},${y},${z}`;
export function hasPaint(volume) {
  return Boolean(volume.paint?.size || (volume.pullSource && hasPaint(volume.pullSource)) || (volume.cutSource && hasPaint(volume.cutSource)) || (volume.extrudeSource && hasPaint(volume.extrudeSource)));
}
function inherited(volume,x,y,z) {
  if(volume.pullSource)return samplePaint(volume.pullSource,...inverseWarp(x,y,z,volume.pullWarp));
  if(volume.cutSource)return samplePaint(volume.cutSource,x,y,z);
  if(volume.extrudeSource && hasPaint(volume.extrudeSource) && volume.extrudeSource.sample(x,y,z)<.08)return samplePaint(volume.extrudeSource,x,y,z);
  return empty;
}
export function samplePaint(volume,x,y,z) {
  const source=inherited(volume,x,y,z);
  if(!volume.paint?.size)return source;
  const cell=volume.paintCell ?? PAINT_CELL;
  const p=[x,y,z].map(v=>v/cell),base=p.map(Math.floor),f=p.map((v,i)=>v-base[i]);
  const out=[0,0,0,0];
  for(let dz=0;dz<=1;dz++)for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++) {
    const weight=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]);
    if(!weight)continue;
    const color=volume.paint.get(key(base[0]+dx,base[1]+dy,base[2]+dz)) ?? source;
    for(let c=0;c<4;c++)out[c]+=color[c]*weight;
  }
  return out;
}

export function enablePaintMaterial(material) {
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 paintColor;\nvarying vec4 vPaintColor;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintColor = paintColor;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 vPaintColor;')
      .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = diffuseColor.rgb * (1.0-vPaintColor.a) + vPaintColor.rgb;');
  };
  material.customProgramCacheKey=()=>`${cache}:surface-paint-v1`;material.needsUpdate=true;
}

export function applyVertexPaint(volume,geometry,bounds=null) {
  const positions=geometry.attributes.position;
  let colors=geometry.getAttribute('paintColor');
  if(!colors || colors.count!==positions.count) {
    colors=new THREE.BufferAttribute(new Float32Array(positions.count*4),4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('paintColor',colors);
  }
  if(!hasPaint(volume)) {colors.array.fill(0);colors.needsUpdate=true;return;}
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
    if(bounds && (x<bounds.min.x || x>bounds.max.x || y<bounds.min.y || y>bounds.max.y || z<bounds.min.z || z>bounds.max.z))continue;
    colors.setXYZW(i,...samplePaint(volume,x,y,z));
  }
  colors.needsUpdate=true;
}

export function refreshPaint(volume,bounds=null) {
  for(const {mesh} of volume.bricks.values()) {
    if(bounds) {
      mesh.geometry.boundingBox ??=new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
      if(!mesh.geometry.boundingBox.intersectsBox(bounds))continue;
    }
    applyVertexPaint(volume,mesh.geometry,bounds);
  }
}

// Rasterize a soft disk swept along surface hits, storing only touched cells.
export function paintSegment(volume,a,b,normal,radius,color,changes,coverage=new Map(),bases=new Map(),startNormal=normal) {
  volume.paint ??=new Map();
  if(!volume.paint.size)volume.paintCell=PAINT_CELL;
  const cell=volume.paintCell ?? PAINT_CELL;
  const padding=Math.max(radius,.09)+cell;
  const bounds=new THREE.Box3().setFromPoints([a,b]).expandByScalar(padding);
  const min=bounds.min.toArray().map(v=>Math.floor(v/cell)),max=bounds.max.toArray().map(v=>Math.ceil(v/cell));
  const delta=b.clone().sub(a),length=delta.lengthSq();
  const node=new THREE.Vector3(),offset=new THREE.Vector3(),direction=new THREE.Vector3();
  for(let z=min[2];z<=max[2];z++)for(let y=min[1];y<=max[1];y++)for(let x=min[0];x<=max[0];x++) {
    node.set(x*cell,y*cell,z*cell);
    const t=length ? THREE.MathUtils.clamp(offset.copy(node).sub(a).dot(delta)/length,0,1) : 0;
    offset.copy(node).sub(a).addScaledVector(delta,-t);
    direction.copy(startNormal).lerp(normal,t).normalize();
    const depth=Math.abs(offset.dot(direction));
    if(depth>.09)continue;
    const radial=Math.sqrt(Math.max(0,offset.lengthSq()-depth*depth));
    if(radial>radius)continue;
    const fade=1-THREE.MathUtils.smoothstep(radial/radius,.5,1);
    const alpha=fade*(1-THREE.MathUtils.smoothstep(depth,.05,.09));
    if(alpha<.01)continue;
    const id=key(x,y,z);
    // One stroke is one coverage layer, independent of speed or sample count.
    // Repeated segment overlap must not turn a soft edge into opaque blobs.
    if(alpha<=(coverage.get(id) ?? 0))continue;
    const old=volume.paint.get(id) ?? samplePaint(volume,...node.toArray());
    if(!bases.has(id))bases.set(id,old.slice());
    coverage.set(id,alpha);
    const base=bases.get(id);
    const next=[color.r*alpha+base[0]*(1-alpha),color.g*alpha+base[1]*(1-alpha),color.b*alpha+base[2]*(1-alpha),alpha+base[3]*(1-alpha)];
    if(next.every((v,i)=>Math.abs(v-old[i])<.001))continue;
    if(!changes.has(id))changes.set(id,volume.paint.get(id)?.slice());
    volume.paint.set(id,next);
  }
  return bounds;
}
