let original;
let unmodified;
let previousKeys = new Set();
function anchorVertex(bricks, anchor) {
  // Put a vertex at the actual ray hit. Even a brush smaller than the voxel
  // spacing then has a real point to drag; adjacent faces keep their edges.
  for (const brick of bricks) {
    const p = brick.positions, n = brick.normals;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const ux = p[i + 3] - ax, uy = p[i + 4] - ay, uz = p[i + 5] - az;
      const vx = p[i + 6] - ax, vy = p[i + 7] - ay, vz = p[i + 8] - az;
      const wx = anchor[0] - ax, wy = anchor[1] - ay, wz = anchor[2] - az;
      const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const wu = wx * ux + wy * uy + wz * uz, wv = wx * vx + wy * vy + wz * vz;
      const determinant = uu * vv - uv * uv;
      if (determinant < 1e-16) continue;
      const b = (wu * vv - wv * uv) / determinant, c = (wv * uu - wu * uv) / determinant;
      if (b < 1e-5 || c < 1e-5 || b + c > 1 - 1e-5) continue;
      if (Math.hypot(wx - b * ux - c * vx, wy - b * uy - c * vy, wz - b * uz - c * vz) > 1e-5) continue;
      const normal = [0, 1, 2].map(a => n[i + a] * (1 - b - c) + n[i + 3 + a] * b + n[i + 6 + a] * c);
      const length = Math.hypot(...normal) || 1;
      const pos = new Float32Array(p.length + 18), norms = new Float32Array(n.length + 18);
      pos.set(p.subarray(0, i)); norms.set(n.subarray(0, i));
      const corners = [[0, 3], [3, 6], [6, 0]];
      for (let t = 0; t < 3; t++) {
        const at = i + t * 9, [a, d] = corners[t];
        pos.set(p.subarray(i + a, i + a + 3), at); pos.set(p.subarray(i + d, i + d + 3), at + 3); pos.set(anchor, at + 6);
        norms.set(n.subarray(i + a, i + a + 3), at); norms.set(n.subarray(i + d, i + d + 3), at + 3); norms.set(normal.map(v => v / length), at + 6);
      }
      pos.set(p.subarray(i + 9), i + 27); norms.set(n.subarray(i + 9), i + 27);
      brick.positions = pos; brick.normals = norms;
      return;
    }
  }
}
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'begin') {
      original = data.bricks; unmodified = original.map(b => ({ ...b }));
      anchorVertex(original, data.anchor);
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
      const overlaps = [0, 1, 2].every(a => brick.bounds.max[a] >= Math.min(start[a], end[a]) - support
        && brick.bounds.min[a] <= Math.max(start[a], end[a]) + support);
      if (!data.final && !overlaps && !previousKeys.has(brick.key)) continue;
      const positions = brick.positions.slice();
      const normals = brick.normals.slice();
      let affected = false;
      for (let i = 0; overlaps && i < positions.length; i += 3) {
        let x = positions[i], y = positions[i + 1], z = positions[i + 2];
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
      // boundaries. Later carve/bulge/knife edits can then replace the right
      // region without retaining duplicate triangles from an old brick.
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
