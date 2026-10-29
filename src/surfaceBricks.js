import { VOLUME_GRID } from './clayVolume.js';

// Pulls bucket triangles by centroid; their vertices can extend outside the
// owning cell. Replacing only one touched cell would overlap those old faces.
export function spanningSurfaceRegions(bricks) {
  const {min, voxel, brick}=VOLUME_GRID, width=voxel*brick, regions=[];
  for(const {key,positions} of bricks) {
    const owner=key.split(',').map(Number),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<positions.length;i+=3)for(let a=0;a<3;a++) {
      low[a]=Math.min(low[a],positions[i+a]);high[a]=Math.max(high[a],positions[i+a]);
    }
    if(!low.some((v,a)=>v<min+owner[a]*width-1e-6 || high[a]>min+(owner[a]+1)*width+1e-6))continue;
    // Only cells containing triangle interiors need replacement. A halo here
    // joins merely touching owners into a whole-mask rebuild after any pull.
    // The caller already includes the edit/gradient halo in its dirty cells.
    const first=low.map(v=>Math.floor((v+1e-6-min)/width));
    const last=high.map(v=>Math.floor((v-1e-6-min)/width)),keys=new Set([key]);
    for(let a=0;a<3;a++)if(last[a]<first[a])last[a]=first[a];
    for(let z=first[2];z<=last[2];z++)for(let y=first[1];y<=last[1];y++)for(let x=first[0];x<=last[0];x++)keys.add(`${x},${y},${z}`);
    regions.push({key,keys});
  }
  return regions;
}

export function expandSurfaceRebuildKeys(keys, regions) {
  const expanded=new Set(keys),remaining=new Set(regions);
  // Removing a crossing owner can touch another crossing owner. Include the
  // complete connected region before publishing any replacement geometry.
  let changed=true;
  while(changed) {
    changed=false;
    for(const region of remaining) {
      if(![...region.keys].some(key=>expanded.has(key)))continue;
      for(const key of region.keys)expanded.add(key);
      remaining.delete(region);changed=true;
    }
  }
  return expanded;
}

// Pulled triangles may span several cells even when their centroid is stored
// in only one brick. Include their entire bounds, plus a voxel halo, so the
// replacement cannot leave old triangles or omit a neighbouring surface.
export function surfaceBrickKeys(bricks) {
  const keys = new Set(bricks.keys());
  const { min, voxel, brick } = VOLUME_GRID;
  const width = voxel * brick;
  for (const { mesh } of bricks.values()) {
    const positions = mesh.geometry.attributes.position.array;
    if (!positions.length) continue;
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) {
      low[a] = Math.min(low[a], positions[i + a]);
      high[a] = Math.max(high[a], positions[i + a]);
    }
    const first = low.map(v => Math.floor((v - voxel - min) / width));
    const last = high.map(v => Math.floor((v + voxel - min) / width));
    for (let z = first[2]; z <= last[2]; z++)
      for (let y = first[1]; y <= last[1]; y++)
        for (let x = first[0]; x <= last[0]; x++) keys.add(`${x},${y},${z}`);
  }
  return keys;
}
