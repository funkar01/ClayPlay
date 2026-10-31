import * as THREE from 'three';
import { inverseWarp } from './maskWarp.js';
import { extrusionDistance } from './extrudeGeometry.js';

const empty=[0,0,0,0],epsilon=1e-7;

// Positive means the new extrusion owns this point; negative means its source
// owns it. Compare both fields rather than the old surface's meshing error.
export function extrusionMaterialMargin(source,stroke,x,y,z) {
  const distance=source.sample(x,y,z);
  return distance-extrusionDistance(x,y,z,stroke,Math.max(.04,distance+.04));
}

export function inheritsExtrusionPaint(volume,x,y,z) {
  if(!volume.extrusion?.color)return volume.extrudeSource.sample(x,y,z)<.08;
  return extrusionMaterialMargin(volume.extrudeSource,volume.extrusion,x,y,z)<=epsilon;
}

export function extrusionMaterialTree(volume,map=null) {
  if(!volume)return null;
  if(volume.pullSource) {
    const transform=(x,y,z)=>inverseWarp(...(map?map(x,y,z):[x,y,z]),volume.pullWarp);
    return extrusionMaterialTree(volume.pullSource,transform);
  }
  if(volume.cutSource)return extrusionMaterialTree(volume.cutSource,map);
  if(!volume.extrudeSource)return null;
  const base=extrusionMaterialTree(volume.extrudeSource,map),stroke=volume.extrusion;
  if(!stroke?.color)return base;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],padding=Math.max(...stroke.radii)+.04;
  for(const point of stroke.points)for(let a=0;a<3;a++) {
    min[a]=Math.min(min[a],point[a]-padding);max[a]=Math.max(max[a],point[a]+padding);
    if(a===0 && stroke.symmetry){min[a]=Math.min(min[a],-point[a]-padding);max[a]=Math.max(max[a],-point[a]+padding);}
  }
  return {base,map,bounds:{min,max},color:[...stroke.color,1],margin(x,y,z){
    if(map)[x,y,z]=map(x,y,z);
    if(x<min[0]||x>max[0]||y<min[1]||y>max[1]||z<min[2]||z>max[2])return -.04;
    const value=extrusionMaterialMargin(volume.extrudeSource,stroke,x,y,z);
    return Math.abs(value)<epsilon?0:value;
  }};
}

export function extrusionMaterialColor(tree,x,y,z) {
  for(let node=tree;node;node=node.base)if(node.margin(x,y,z)>0)return node.color;
  return empty;
}

// Split only triangles that straddle a material boundary. New vertices lie
// on the existing triangle, so this never changes the sculpted surface. Each
// resulting face has one material color: no broad fade or mixed-color collar.
export function partitionExtrusionMaterials(geometry,tree) {
  const positions=geometry.attributes.position,normals=geometry.attributes.normal;
  if(!tree || !normals || geometry.index || positions.count%3)return false;
  if(Object.keys(geometry.attributes).some(key=>!['position','normal','paintColor','extrudeColor'].includes(key)))return false;
  const pointCache=new Map(),edgeCaches=new WeakMap(),marginCaches=new WeakMap();
  const colors=new Float32Array(positions.count*4),replacements=[];
  let outPositions,outNormals,outColors;
  const vertex=i=>{
    const p=[positions.getX(i),positions.getY(i),positions.getZ(i)],key=p.join(',');
    let value=pointCache.get(key);
    if(!value){value={p,key,n:[normals.getX(i),normals.getY(i),normals.getZ(i)]};pointCache.set(key,value);}
    return value;
  };
  const margin=(node,v)=>{
    let cache=marginCaches.get(node);if(!cache){cache=new Map();marginCaches.set(node,cache);}
    if(!cache.has(v.key))cache.set(v.key,node.margin(...v.p));
    return cache.get(v.key);
  };
  const crossing=(node,a,b,da,db)=>{
    let cache=edgeCaches.get(node);if(!cache){cache=new Map();edgeCaches.set(node,cache);}
    if(a.key>b.key){[a,b]=[b,a];[da,db]=[db,da];}
    const key=a.key+'|'+b.key;let value=cache.get(key);
    if(!value) {
      const t=da/(da-db),p=a.p.map((n,i)=>n+(b.p[i]-n)*t),n=a.n.map((v,i)=>v+(b.n[i]-v)*t);
      const length=Math.hypot(...n)||1;value={p,n:n.map(v=>v/length),key:p.join(',')};cache.set(key,value);
      marginCaches.get(node).set(value.key,0);
    }
    return value;
  };
  const emit=(vertices,color)=>{
    for(let i=1;i<vertices.length-1;i++) {
      const a=vertices[0],b=vertices[i],c=vertices[i+1];
      const u=b.p.map((n,k)=>n-a.p[k]),v=c.p.map((n,k)=>n-a.p[k]);
      if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)continue;
      for(const p of [a,b,c]){outPositions.push(...p.p);outNormals.push(...p.n);outColors.push(...color);}
    }
  };
  const partition=(vertices,node)=>{
    if(!node){emit(vertices,empty);return;}
    const distances=vertices.map(v=>margin(node,v));
    if(distances.every(d=>d<=0)){partition(vertices,node.base);return;}
    if(distances.every(d=>d>=0)){emit(vertices,node.color);return;}
    const added=[],original=[];
    for(let i=0;i<vertices.length;i++) {
      const a=vertices[i],b=vertices[(i+1)%vertices.length],da=distances[i],db=distances[(i+1)%vertices.length];
      if(da>=0)added.push(a);if(da<=0)original.push(a);
      if((da>0&&db<0)||(da<0&&db>0)){const p=crossing(node,a,b,da,db);added.push(p);original.push(p);}
    }
    if(added.length>=3)emit(added,node.color);
    if(original.length>=3)partition(original,node.base);
  };
  for(let i=0;i<positions.count;i+=3) {
    let node=tree,vertices=null,color=empty,mixed=false;
    while(node) {
      // Most faces belong to an unchanged part of the mask. Reject their
      // whole triangle before allocating vertices or querying source fields.
      const bounds=!node.map && node.bounds;
      if(bounds && [0,1,2].some(a=>{
        const p=positions.array,offset=i*3+a;
        return Math.max(p[offset],p[offset+3],p[offset+6])<bounds.min[a] || Math.min(p[offset],p[offset+3],p[offset+6])>bounds.max[a];
      })){node=node.base;continue;}
      vertices ??=[vertex(i),vertex(i+1),vertex(i+2)];
      const distances=vertices.map(v=>margin(node,v));
      if(distances.every(d=>d<=0)){node=node.base;continue;}
      if(distances.every(d=>d>=0)){color=node.color;break;}
      mixed=true;break;
    }
    if(!mixed) {
      if(color!==empty)for(let j=0;j<3;j++)colors.set(color,(i+j)*4);
      continue;
    }
    outPositions=[];outNormals=[];outColors=[];
    partition(vertices,node);replacements.push({i,positions:outPositions,normals:outNormals,colors:outColors});
  }
  if(replacements.length) {
    const count=positions.count+replacements.reduce((sum,p)=>sum+p.positions.length/3-3,0);
    const p=new Float32Array(count*3),n=new Float32Array(count*3),c=new Float32Array(count*4);
    let previous=0,destination=0;
    for(const replacement of replacements) {
      const unchanged=replacement.i-previous;
      p.set(positions.array.subarray(previous*3,replacement.i*3),destination*3);
      n.set(normals.array.subarray(previous*3,replacement.i*3),destination*3);
      c.set(colors.subarray(previous*4,replacement.i*4),destination*4);
      destination+=unchanged;
      p.set(replacement.positions,destination*3);n.set(replacement.normals,destination*3);c.set(replacement.colors,destination*4);
      destination+=replacement.positions.length/3;previous=replacement.i+3;
    }
    p.set(positions.array.subarray(previous*3),destination*3);n.set(normals.array.subarray(previous*3),destination*3);c.set(colors.subarray(previous*4),destination*4);
    geometry.setAttribute('position',new THREE.BufferAttribute(p,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(n,3));
    geometry.setAttribute('extrudeColor',new THREE.BufferAttribute(c,4));
    geometry.deleteAttribute('paintColor');
  } else geometry.setAttribute('extrudeColor',new THREE.BufferAttribute(colors,4));
  return true;
}
