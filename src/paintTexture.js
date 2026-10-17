import * as THREE from 'three';

// Allocate only the painted region, on a padded grid. Hardware interpolation
// makes thin lines independent of the mask's marching-cubes triangles.
export function syncPaintTexture(state, volume, sample, hasPaint) {
  if (!state.dirty) return;
  state.dirty = false;
  if (!hasPaint(volume)) { state.uniforms.paintEnabled.value = 0; return; }
  const cell = volume.paintCell ?? .02;
  const bounds = new THREE.Box3();
  for (const id of volume.paint?.keys() ?? []) {
    const p = id.split(',').map(Number).map(v => v * cell);
    bounds.expandByPoint(new THREE.Vector3(...p));
  }
  const inherited = [volume.pullSource, volume.cutSource, volume.extrudeSource].some(s => s && hasPaint(s));
  if (inherited) for (const {mesh} of volume.bricks.values()) {
    mesh.geometry.computeBoundingBox(); bounds.union(mesh.geometry.boundingBox);
  }
  if (bounds.isEmpty()) { state.uniforms.paintEnabled.value = 0; return; }
  // Grow in half-unit blocks, avoiding texture allocation on each new sample.
  const min = bounds.min.toArray().map(v => Math.floor(Math.floor((v - cell * 2) / .5) * .5 / cell) * cell);
  const max = bounds.max.toArray().map(v => Math.ceil(Math.ceil((v + cell * 2) / .5) * .5 / cell) * cell);
  let spacing = cell;
  const dimensions = () => max.map((v,i) => Math.ceil((v-min[i])/spacing)+1);
  let size = dimensions();
  while (size.some(v => v > 256) || size.reduce((a,b)=>a*b,1)>2_000_000) { spacing *= 2; size = dimensions(); }
  const signature = JSON.stringify([min,size,spacing]);
  const rebuild = signature !== state.signature || state.source !== volume.pullSource || state.cut !== volume.cutSource || state.extrude !== volume.extrudeSource;
  if (rebuild) {
    state.texture?.dispose();
    state.texture = new THREE.Data3DTexture(new Uint8Array(size[0]*size[1]*size[2]*4),...size);
    Object.assign(state.texture,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,unpackAlignment:1});
    state.signature=signature;state.source=volume.pullSource;state.cut=volume.cutSource;state.extrude=volume.extrudeSource;
    state.uniforms.paintMap.value=state.texture;
    state.uniforms.paintOrigin.value.fromArray(min).addScalar(-spacing*.5);
    state.uniforms.paintExtent.value.set(...size.map(v=>v*spacing));
  }
  const data=state.texture.image.data;
  const dirty = !rebuild && state.bounds;
  const lo=dirty ? dirty.min.toArray().map((v,i)=>Math.max(0,Math.floor((v-min[i])/spacing)-1)) : [0,0,0];
  const hi=dirty ? dirty.max.toArray().map((v,i)=>Math.min(size[i]-1,Math.ceil((v-min[i])/spacing)+1)) : size.map(v=>v-1);
  // Empty space needs no sampling when there is no inherited paint.
  if (rebuild && !inherited && spacing===cell) {
    for (const [id,color] of volume.paint) {
      const p=id.split(',').map(Number).map((v,i)=>Math.round((v*cell-min[i])/spacing));
      const index=((p[2]*size[1]+p[1])*size[0]+p[0])*4;
      for(let c=0;c<4;c++)data[index+c]=Math.round(THREE.MathUtils.clamp(color[c],0,1)*255);
    }
  } else for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++) {
    const color=sample(volume,min[0]+x*spacing,min[1]+y*spacing,min[2]+z*spacing);
    const index=((z*size[1]+y)*size[0]+x)*4;
    for(let c=0;c<4;c++)data[index+c]=Math.round(THREE.MathUtils.clamp(color[c],0,1)*255);
  }
  state.bounds=null;state.texture.needsUpdate=true;state.uniforms.paintEnabled.value=1;
}
