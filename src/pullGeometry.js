export function anchorVertex(bricks, anchor, tolerance = 1e-5) {
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
      if (Math.hypot(wx - b * ux - c * vx, wy - b * uy - c * vy, wz - b * uz - c * vz) > tolerance) continue;
      const vertex = [ax + b * ux + c * vx, ay + b * uy + c * vy, az + b * uz + c * vz];
      const normal = [0, 1, 2].map(a => n[i + a] * (1 - b - c) + n[i + 3 + a] * b + n[i + 6 + a] * c);
      const length = Math.hypot(...normal) || 1;
      const pos = new Float32Array(p.length + 18), norms = new Float32Array(n.length + 18);
      pos.set(p.subarray(0, i)); norms.set(n.subarray(0, i));
      const corners = [[0, 3], [3, 6], [6, 0]];
      for (let t = 0; t < 3; t++) {
        const at = i + t * 9, [a, d] = corners[t];
        pos.set(p.subarray(i + a, i + a + 3), at); pos.set(p.subarray(i + d, i + d + 3), at + 3); pos.set(vertex, at + 6);
        norms.set(n.subarray(i + a, i + a + 3), at); norms.set(n.subarray(i + d, i + d + 3), at + 3); norms.set(normal.map(v => v / length), at + 6);
      }
      pos.set(p.subarray(i + 9), i + 27); norms.set(n.subarray(i + 9), i + 27);
      brick.positions = pos; brick.normals = norms;
      return;
    }
  }
}

