import { VOLUME_GRID } from './clayVolume.js';

// Cache grid samples throughout the immutable deformation chain. A sample of
// a pulled field otherwise recursively evaluates eight source nodes per layer.
// Live overlay edits always override the cached underlying field.
const cached=new WeakSet();
export function cacheVolumeNodes(volume, seen = new WeakSet()) {
  if (!volume || seen.has(volume) || cached.has(volume)) return volume;
  seen.add(volume);
  cached.add(volume);
  for (const source of [volume.pullSource, volume.cutSource, volume.extrudeSource]) cacheVolumeNodes(source, seen);
  const sample = volume.nodeValue.bind(volume), nodes = new Map();
  volume.nodeValue = (x, y, z) => {
    const key = volume.nodeKey(x, y, z), edit = volume.field.get(key);
    if (edit !== undefined) return edit;
    if (nodes.has(key)) return nodes.get(key);
    const value = sample(x, y, z); nodes.set(key, value); return value;
  };
  // Reuse source-grid samples on later extrusions, including empty overlays
  // whose analytic fast path otherwise bypasses their warm node caches.
  volume.peekNodeSample=(x,y,z)=>{
    const {min,voxel}=VOLUME_GRID,ix=Math.round((x-min)/voxel),iy=Math.round((y-min)/voxel),iz=Math.round((z-min)/voxel);
    if(x!==min+ix*voxel || y!==min+iy*voxel || z!==min+iz*voxel)return undefined;
    const key=volume.nodeKey(ix,iy,iz);
    return volume.field.get(key) ?? nodes.get(key);
  };
  const sampleField=volume.sample.bind(volume);
  volume.sample=(x,y,z)=>{
    if(!volume.field.size) {
      const {min,voxel}=VOLUME_GRID;
      const gx=(x-min)/voxel,gy=(y-min)/voxel,gz=(z-min)/voxel;
      const ix=Math.round(gx),iy=Math.round(gy),iz=Math.round(gz);
      if(x===min+ix*voxel && y===min+iy*voxel && z===min+iz*voxel)return volume.nodeValue(ix,iy,iz);
    }
    return sampleField(x,y,z);
  };
  return volume;
}
