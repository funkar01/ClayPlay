import { projectCutPoint } from './cutGeometry.js';
import { VOLUME_GRID as grid } from './clayVolume.js';

// A brush sweeps a capsule in the camera plane, through the thin mask shell.
// Testing the reflected object point mirrors removal even on a moved mask.
function makeEraseBrush(points, radius, eye, planeZ, symmetry) {
  const segments = points.map((b, i) => {
    const a = points[Math.max(0, i - 1)], dx = b[0] - a[0], dy = b[1] - a[1];
    return [a[0], a[1], dx, dy, 1 / (dx * dx + dy * dy || 1)];
  });
  const distanceSquared = (px, py) => {
    let nearest = Infinity;
    for (const [ax, ay, dx, dy, inverse] of segments) {
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) * inverse));
      const x = px - ax - t * dx, y = py - ay - t * dy;
      nearest = Math.min(nearest, x * x + y * y);
    }
    return nearest;
  };
  return (x, y, z) => {
    const t = (planeZ - eye[2]) / (z - eye[2]), py = eye[1] + (y - eye[1]) * t;
    const direct = distanceSquared(eye[0] + (x - eye[0]) * t, py);
    const mirror = symmetry ? distanceSquared(eye[0] + (-x - eye[0]) * t, py) : Infinity;
    return radius - Math.sqrt(Math.min(direct, mirror));
  };
}

export function eraseDistance(x, y, z, points, radius, eye, planeZ, symmetry = false) {
  return makeEraseBrush(points, radius, eye, planeZ, symmetry)(x, y, z);
}

export function eraseBrickBounds(bricks, eye, planeZ) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of bricks) for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], positions[i + a]); max[a] = Math.max(max[a], positions[i + a]);
  }
  if (!Number.isFinite(min[0])) return [];
  const cell = grid.brick * grid.voxel, count = grid.cells / grid.brick;
  const start = min.map(v => Math.floor((v - grid.min - grid.voxel * 2) / cell));
  const end = max.map(v => Math.floor((v - grid.min + grid.voxel * 2) / cell));
  const bounds = [];
  for (let z = start[2]; z <= end[2]; z++) for (let y = start[1]; y <= end[1]; y++) for (let x = start[0]; x <= end[0]; x++) {
    const direct = [Infinity, Infinity, -Infinity, -Infinity], mirror = [...direct];
    for (const ox of [0, 1]) for (const oy of [0, 1]) for (const oz of [0, 1]) {
      const p = [grid.min + (x + ox) * cell, grid.min + (y + oy) * cell, grid.min + (z + oz) * cell];
      for (const [box, reflected] of [[direct, false], [mirror, true]]) {
        const q = projectCutPoint(reflected ? -p[0] : p[0], p[1], p[2], eye, planeZ);
        box[0] = Math.min(box[0], q[0]); box[1] = Math.min(box[1], q[1]);
        box[2] = Math.max(box[2], q[0]); box[3] = Math.max(box[3], q[1]);
      }
    }
    bounds.push({ key: `${x},${y},${z}`, direct, mirror });
  }
  return bounds;
}

export function eraseNodes(volume, bounds, points, radius, eye, planeZ, symmetry) {
  if (!points.length || radius <= 0) return { edits: [], keys: [] };
  const padding = radius + grid.voxel * 2;
  const stroke = [Math.min(...points.map(p => p[0])) - padding, Math.min(...points.map(p => p[1])) - padding,
    Math.max(...points.map(p => p[0])) + padding, Math.max(...points.map(p => p[1])) + padding];
  const overlap = b => b[0] <= stroke[2] && b[2] >= stroke[0] && b[1] <= stroke[3] && b[3] >= stroke[1];
  const visited = new Set();
  const edits = new Map(), dirty = new Set(), brush = makeEraseBrush(points, radius, eye, planeZ, symmetry);
  for (const bound of bounds) {
    if (!overlap(bound.direct) && !(symmetry && overlap(bound.mirror))) continue;
    const start = bound.key.split(',').map(v => Number(v) * grid.brick);
    // Two nodes of halo keep gradients and adjacent brick seams consistent.
    for (let iz = start[2] - 2; iz <= start[2] + grid.brick + 2; iz++)
      for (let iy = start[1] - 2; iy <= start[1] + grid.brick + 2; iy++)
        for (let ix = start[0] - 2; ix <= start[0] + grid.brick + 2; ix++) {
          const key = volume.nodeKey(ix, iy, iz);
          if (visited.has(key)) continue;
          visited.add(key);
          const removal = brush(grid.min + ix * grid.voxel, grid.min + iy * grid.voxel, grid.min + iz * grid.voxel);
          if (removal < -grid.voxel * 2) continue;
          const old = volume.nodeValue(ix, iy, iz);
          // Empty space does not need an overlay or a history entry.
          if (old > grid.voxel * 2 || removal <= old + 1e-7) continue;
          volume.field.set(key, removal); edits.set(key, removal);
          // A node shared by a brick edge also affects its neighbour's normals.
          for (let bz = Math.floor((iz - 2) / grid.brick); bz <= Math.floor((iz + 1) / grid.brick); bz++)
            for (let by = Math.floor((iy - 2) / grid.brick); by <= Math.floor((iy + 1) / grid.brick); by++)
              for (let bx = Math.floor((ix - 2) / grid.brick); bx <= Math.floor((ix + 1) / grid.brick); bx++) dirty.add(`${bx},${by},${bz}`);
        }
  }
  return { edits: [...edits], keys: [...dirty] };
}
