import * as THREE from 'three';
import { syncPaintTexture } from './paintTexture.js';
import { inverseWarp } from './maskWarp.js';

export const PAINT_CELL=.02;
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
  // Missing custom attributes otherwise use WebGL's opaque (0,0,0,1).
  // An uninitialized mesh must show its clay color, never black paint.
  material.defaultAttributeValues={...material.defaultAttributeValues,paintColor:[0,0,0,0]};
  const state={dirty:true,uniforms:{paintEnabled:{value:0},paintMap:{value:null},paintOrigin:{value:new THREE.Vector3()},paintExtent:{value:new THREE.Vector3(1,1,1)}}};
  material.userData.surfacePaint=state;
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey(),render=material.onBeforeRender;
  material.onBeforeRender=function(...args) {
    render?.apply(this,args);
    if(state.volume)syncPaintTexture(state,state.volume,samplePaint,hasPaint);
  };
  material.addEventListener('dispose',()=>state.texture?.dispose());
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    Object.assign(shader.uniforms,state.uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 paintColor;\nvarying vec4 vPaintColor;\nvarying vec3 vPaintPosition;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintColor = paintColor;\nvPaintPosition = position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec4 vPaintColor;
      varying vec3 vPaintPosition;
      uniform highp sampler3D paintMap;
      uniform float paintEnabled;
      uniform vec3 paintOrigin;
      uniform vec3 paintExtent;`)
      .replace('#include <color_fragment>',`#include <color_fragment>
      vec4 pigment = vPaintColor;
      if (paintEnabled > 0.5) {
        vec3 uvw = (vPaintPosition - paintOrigin) / paintExtent;
        pigment = all(greaterThanEqual(uvw,vec3(0.0))) && all(lessThanEqual(uvw,vec3(1.0))) ? texture(paintMap,uvw) : vec4(0.0);
        float edge = max(0.035, fwidth(pigment.a));
        float ink = smoothstep(0.45-edge,0.45+edge,pigment.a);
        pigment.rgb *= ink / max(pigment.a,0.001);
        pigment.a = ink;
      }
      diffuseColor.rgb = diffuseColor.rgb * (1.0-pigment.a) + pigment.rgb;`);
  };
  material.customProgramCacheKey=()=>`${cache}:surface-paint-v2`;material.needsUpdate=true;
}

export function applyVertexPaint(volume,geometry,bounds=null) {
  const textureState=volume.material?.userData.surfacePaint;
  if(textureState){textureState.volume=volume;textureState.dirty=true;textureState.bounds=null;}
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
  const state=volume.material?.userData.surfacePaint;
  if(state) {
    state.volume=volume;
    if(!state.dirty && bounds)state.bounds=bounds.clone();
    else if(state.bounds && bounds)state.bounds.union(bounds);
    else state.bounds=null;
    state.dirty=true;
    return;
  }
  for(const {mesh} of volume.bricks.values()) {
    if(bounds) {
      mesh.geometry.boundingBox ??=new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
      if(!mesh.geometry.boundingBox.intersectsBox(bounds))continue;
    }
    applyVertexPaint(volume,mesh.geometry,bounds);
  }
}

// Sweep a solid brush along surface hits, storing only touched cells.
export function paintSegment(volume,a,b,normal,radius,color,changes,coverage=new Map(),bases=new Map(),startNormal=normal) {
  volume.paint ??=new Map();
  if(!volume.paint.size)volume.paintCell=PAINT_CELL;
  const cell=volume.paintCell ?? PAINT_CELL;
  const padding=Math.max(radius,.09)+cell;
  const bounds=new THREE.Box3().setFromPoints([a,b]).expandByScalar(padding);
  if(startNormal.dot(normal)>.9999) {
    // A nearly planar stroke needs only a thin slab, not a radius-deep cube.
    const extent=new THREE.Vector3(...normal.toArray().map(n=>radius*Math.sqrt(Math.max(0,1-n*n))+.09*Math.abs(n)+cell*2));
    bounds.setFromPoints([a,b]);bounds.min.sub(extent);bounds.max.add(extent);
  }
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
    const fade=1-THREE.MathUtils.smoothstep(radial/radius,.8,1);
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
