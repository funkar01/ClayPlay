function roundedBox(x, y, z, hx, hy, hz, radius) {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const qz = Math.abs(z) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
    + Math.min(Math.max(qx, qy, qz), 0) - radius;
}

// Exact distance to a triangular cross-section, extruded along Z.
const triangle = [[-1.05, -0.8], [1.05, -0.8], [0, 1.15]];
function roundedPrism(x, y, z) {
  let squaredDistance = Infinity;
  let inside = true;
  for (let i = 0; i < 3; i += 1) {
    const [ax, ay] = triangle[i];
    const [bx, by] = triangle[(i + 1) % 3];
    const ex = bx - ax;
    const ey = by - ay;
    const px = x - ax;
    const py = y - ay;
    const t = Math.max(0, Math.min(1, (px * ex + py * ey) / (ex * ex + ey * ey)));
    squaredDistance = Math.min(squaredDistance, (px - ex * t) ** 2 + (py - ey * t) ** 2);
    if (ex * py - ey * px < 0) inside = false;
  }
  const crossSection = Math.sqrt(squaredDistance) * (inside ? -1 : 1);
  const depth = Math.abs(z) - 0.65;
  return Math.hypot(Math.max(crossSection, 0), Math.max(depth, 0))
    + Math.min(Math.max(crossSection, depth), 0) - 0.16;
}

export const CLAY_SHAPES = {
  sphere: { label: 'Sphere', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', distance: (x, y, z) => Math.hypot(x, y, z) - 1.25 },
  cube: { label: 'Rounded cube', icon: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z', distance: (x, y, z) => roundedBox(x, y, z, 0.85, 0.85, 0.85, 0.2) },
  prism: { label: 'Rounded prism', icon: 'm10 4-7 14q-1 2 2 2h14q3 0 2-2L14 4q-2-3-4 0Z', distance: roundedPrism },
  cylinder: {
    label: 'Cylinder', icon: 'M4 6a8 3 0 1 0 16 0 8 3 0 1 0-16 0Zm0 0v12a8 3 0 0 0 16 0V6',
    distance: (x, y, z) => {
      const radial = Math.hypot(x, z) - 0.86;
      const height = Math.abs(y) - 0.95;
      return Math.hypot(Math.max(radial, 0), Math.max(height, 0)) + Math.min(Math.max(radial, height), 0) - 0.14;
    },
  },
  capsule: { label: 'Capsule', icon: 'M6 8a6 6 0 0 1 12 0v8a6 6 0 0 1-12 0Z', distance: (x, y, z) => Math.hypot(x, y - Math.max(-0.6, Math.min(0.6, y)), z) - 0.7 },
  ring: { label: 'Ring', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', distance: (x, y, z) => Math.hypot(Math.hypot(x, y) - 0.88, z) - 0.36 },
};
