import { inverseWarp } from './maskWarp.js';
import { inheritsExtrusionPaint } from './extrusionMaterials.js';

const empty=[0,0,0,0];
const contains=(b,x,y,z)=>b && x>=b.min[0] && x<=b.max[0] && y>=b.min[1] && y<=b.max[1] && z>=b.min[2] && z<=b.max[2];

// Compile one immutable paint revision once per texture job. Most of a mask's
// 3D texture is empty: reject those texels before evaluating old deformations,
// inverse warps or inherited pigment. The sampling/interpolation stays exact.
export function createPaintSampler(volume) {
  const compile=v=>{
    if(!v)return null;
    const paint=v.paint,cell=v.paintCell ?? .02;
    const source=compile(v.pullSource ?? v.cutSource ?? v.extrudeSource);
    if(!paint?.size && !source)return null;
    let inheritedBounds=source?.bounds;
    if(inheritedBounds && v.pullSource) {
      const delta=v.pullWarp.delta.map(Math.abs);
      inheritedBounds={min:inheritedBounds.min.map((n,a)=>n-delta[a]),max:inheritedBounds.max.map((n,a)=>n+delta[a])};
    }
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    if(inheritedBounds){bounds.min=[...inheritedBounds.min];bounds.max=[...inheritedBounds.max];}
    for(const key of paint?.keys() ?? []) {
      const node=key.split(',').map(Number);
      for(let a=0;a<3;a++) {
        bounds.min[a]=Math.min(bounds.min[a],(node[a]-1)*cell-1e-9);
        bounds.max[a]=Math.max(bounds.max[a],(node[a]+1)*cell+1e-9);
      }
    }
    const sample=(x,y,z)=>{
      if(!contains(bounds,x,y,z))return empty;
      let inherited=empty;
      if(source && contains(inheritedBounds,x,y,z)) {
        if(v.pullSource)inherited=source.sample(...inverseWarp(x,y,z,v.pullWarp));
        else if(!v.extrudeSource || inheritsExtrusionPaint(v,x,y,z))inherited=source.sample(x,y,z);
      }
      if(!paint?.size)return inherited;
      const p=[x,y,z].map(n=>n/cell),base=p.map(Math.floor),f=p.map((n,a)=>n-base[a]);
      const out=[0,0,0,0];
      for(let dz=0;dz<=1;dz++)for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++) {
        const weight=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]);
        if(!weight)continue;
        const color=paint.get(`${base[0]+dx},${base[1]+dy},${base[2]+dz}`) ?? inherited;
        for(let a=0;a<4;a++)out[a]+=color[a]*weight;
      }
      return out;
    };
    return {sample,bounds};
  };
  return compile(volume)?.sample ?? (()=>empty);
}
