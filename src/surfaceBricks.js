import { VOLUME_GRID } from './clayVolume.js';

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
