import { outsideStroke, warpVertex } from './maskWarp.js';
import { anchorVertex } from './pullGeometry.js';
let original;
let unmodified;
let previousKeys = new Set();
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'begin') {
      original = data.bricks; unmodified = original.map(b => ({ ...b }));
      anchorVertex(original, data.anchor);
      if (data.symmetry && Math.abs(data.anchor[0]) > 1e-6) anchorVertex(original, [-data.anchor[0], data.anchor[1], data.anchor[2]], 0.005);
      for (const brick of original) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < brick.positions.length; i += 3) for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], brick.positions[i + a]); max[a] = Math.max(max[a], brick.positions[i + a]);
        }
        brick.bounds = { min, max };
      }
      previousKeys.clear(); return;
    }
    const start = performance.now();
    const bricks = [], transfer = [];
    const { center: [cx, cy, cz], delta: [dx, dy, dz], support } = data.warp;
    const steps = data.warp.steps ?? [data.warp];
    const squaredLength = dx * dx + dy * dy + dz * dz;
    if (data.final && squaredLength <= 0.00000025) {
      const restored = unmodified.map(b => ({ key: b.key, positions: b.positions.slice(), normals: b.normals.slice() }));
      self.postMessage({ bricks: restored, warp: data.warp, final: true, duration: performance.now() - start }, restored.flatMap(b => [b.positions.buffer, b.normals.buffer]));
      return;
    }
    const squaredSupport = support * support;
    const nextKeys = new Set();
    for (const brick of original) {
      const start = [cx, cy, cz], end = [cx + dx, cy + dy, cz + dz];
      const intersects = (start, end) => [0, 1, 2].every(a => brick.bounds.max[a] >= Math.min(start[a], end[a]) - support
        && brick.bounds.min[a] <= Math.max(start[a], end[a]) + support);
      const overlaps = intersects(start, end) || (data.warp.symmetry && intersects([-cx, cy, cz], [-cx - dx, cy + dy, cz + dz]));
      if (!data.final && !overlaps && !previousKeys.has(brick.key)) continue;
      const positions = brick.positions.slice();
      const normals = brick.normals.slice();
      let affected = false;
      for (let i = 0; overlaps && i < positions.length; i += 3) {
        let x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (data.warp.symmetry) {
          if (outsideStroke(x, y, z, data.warp)) continue;
          const result = warpVertex(x, y, z, [normals[i], normals[i + 1], normals[i + 2]], data.warp);
          positions.set(result.point, i); normals.set(result.normal, i); affected = true;
          continue;
        }
        const ox = x - cx, oy = y - cy, oz = z - cz;
        const along = squaredLength ? Math.max(0, Math.min(1, (ox * dx + oy * dy + oz * dz) / squaredLength)) : 0;
        if ((ox - dx * along) ** 2 + (oy - dy * along) ** 2 + (oz - dz * along) ** 2 >= squaredSupport) continue;
        let nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
        for (const step of steps) {
          const sx = x - step.center[0], sy = y - step.center[1], sz = z - step.center[2];
          const squaredDistance = sx * sx + sy * sy + sz * sz;
          if (squaredDistance >= squaredSupport) continue;
          affected = true;
          const distance = Math.sqrt(squaredDistance), r = distance / support, falloff = step.falloff ?? 1;
          const t = Math.max(0, (r - 0.35) / 0.65);
          const baseWeight = 1 - t * t * (3 - 2 * t), weight = baseWeight ** falloff;
          const gradientScale = distance && t > 0 ? -6 * t * (1 - t) * falloff * baseWeight ** (falloff - 1) / (0.65 * support * distance) : 0;
          const gx = sx * gradientScale, gy = sy * gradientScale, gz = sz * gradientScale;
          const [vx, vy, vz] = step.delta;
          const scale = (vx * nx + vy * ny + vz * nz) / (1 + gx * vx + gy * vy + gz * vz);
          nx -= gx * scale; ny -= gy * scale; nz -= gz * scale;
          const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= normalLength; ny /= normalLength; nz /= normalLength;
          x += vx * weight; y += vy * weight; z += vz * weight;
        }
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
        normals[i] = nx / length; normals[i + 1] = ny / length; normals[i + 2] = nz / length;
      }
      if (affected) nextKeys.add(brick.key);
      if (!data.final && !affected && !previousKeys.has(brick.key)) continue;
      bricks.push({ key: brick.key, positions, normals });
      transfer.push(positions.buffer, normals.buffer);
    }
    previousKeys = nextKeys;
    const repartition = data.final && dx * dx + dy * dy + dz * dz > 0.00000025;
    if (repartition) {
      // Keep the spatial brick ownership correct after triangles move across
      // boundaries, keeping subsequent drags and surface picking consistent.
      const buckets = new Map();
      for (const brick of bricks) for (let i = 0; i < brick.positions.length; i += 9) {
        const gx = Math.max(0, Math.min(7, Math.floor(((brick.positions[i] + brick.positions[i + 3] + brick.positions[i + 6]) / 3 + 2.4) / 0.6)));
        const gy = Math.max(0, Math.min(7, Math.floor(((brick.positions[i + 1] + brick.positions[i + 4] + brick.positions[i + 7]) / 3 + 2.4) / 0.6)));
        const gz = Math.max(0, Math.min(7, Math.floor(((brick.positions[i + 2] + brick.positions[i + 5] + brick.positions[i + 8]) / 3 + 2.4) / 0.6)));
        const key = `${gx},${gy},${gz}`;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = { key, positions: [], normals: [] }; buckets.set(key, bucket); }
        for (let j = 0; j < 9; j++) { bucket.positions.push(brick.positions[i + j]); bucket.normals.push(brick.normals[i + j]); }
      }
      bricks.length = 0; transfer.length = 0;
      for (const bucket of buckets.values()) {
        const positions = new Float32Array(bucket.positions), normals = new Float32Array(bucket.normals);
        bricks.push({ key: bucket.key, positions, normals }); transfer.push(positions.buffer, normals.buffer);
      }
    }
    self.postMessage({ bricks, warp: data.warp, final: data.final, repartition, duration: performance.now() - start }, transfer);
  } catch (error) { self.postMessage({ error: error.message }); }
};
