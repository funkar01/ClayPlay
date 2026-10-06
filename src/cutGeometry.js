// Cuts follow the camera ray through the thin shell. Work in a small 2D
// footprint to find separated pieces, then remesh only the new cut boundary.
export function projectCutPoint(x, y, z, eye, planeZ) {
  const t = (planeZ - eye[2]) / (z - eye[2]);
  return [eye[0] + (x - eye[0]) * t, eye[1] + (y - eye[1]) * t];
}

export function rasterizeMask(bricks, eye, planeZ, requestedCell = 0.018) {
  const triangles = [], min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const brick of bricks) for (let i = 0; i < brick.positions.length; i += 9) {
    const triangle = [];
    for (let a = 0; a < 9; a += 3) {
      const p = projectCutPoint(...brick.positions.subarray(i + a, i + a + 3), eye, planeZ);
      triangle.push(p);
      for (let axis = 0; axis < 2; axis++) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]); }
    }
    triangles.push(triangle);
  }
  const cell = Math.max(requestedCell, (max[0] - min[0]) / 378, (max[1] - min[1]) / 378);
  const width = Math.ceil((max[0] - min[0]) / cell) + 6, height = Math.ceil((max[1] - min[1]) / cell) + 6;
  min[0] -= cell * 3; min[1] -= cell * 3;
  const mask = new Uint8Array(width * height);
  for (const [a, b, c] of triangles) {
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(determinant) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - min[0]) / cell));
    const x1 = Math.min(width - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - min[0]) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - min[1]) / cell));
    const y1 = Math.min(height - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - min[1]) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = min[0] + (x + 0.5) * cell, py = min[1] + (y + 0.5) * cell;
      const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / determinant;
      const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / determinant;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) mask[x + y * width] = 1;
    }
  }
  return { mask, min, width, height, cell, eye, planeZ };
}

function components(mask, width, height) {
  const labels = new Int32Array(mask.length), groups = [], queue = new Int32Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i] && !labels[i]) {
    const id = groups.length + 1; let head = 0, tail = 1;
    queue[0] = i; labels[i] = id;
    while (head < tail) {
      const at = queue[head++], x = at % width, y = Math.floor(at / width);
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1, y > 0 ? at - width : -1, y + 1 < height ? at + width : -1]) {
        if (next >= 0 && mask[next] && !labels[next]) { labels[next] = id; queue[tail++] = next; }
      }
    }
    groups.push({ id, size: tail, first: i });
  }
  return { labels, groups };
}

export function prepareCutPath(points, cell = 0.018) {
  const path = [];
  for (const p of points) if (!path.length || Math.hypot(p[0] - path.at(-1)[0], p[1] - path.at(-1)[1]) >= cell * 0.3) path.push([...p]);
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const closed = path.length >= 6 && length > 0.22 && Math.hypot(path[0][0] - path.at(-1)[0], path[0][1] - path.at(-1)[1]) < Math.max(0.08, cell * 4);
  if (closed) path.push([...path[0]]);
  return { path, closed, length };
}

export function separateCut(footprint, points, symmetry = false) {
  const { mask, min, width, height, cell } = footprint;
  const { path, closed, length } = prepareCutPath(points, cell);
  if (length < 0.12) return { valid: false, reason: 'Trace a longer cut, then release.' };
  const barrier = new Uint8Array(mask.length), paths = symmetry ? [path, path.map(([x, y]) => [-x, y])] : [path];
  const radius = Math.max(0.018, cell * 1.05);
  for (const stroke of paths) for (let i = 1; i < stroke.length; i++) {
    const [ax, ay] = stroke[i - 1], [bx, by] = stroke[i], dx = bx - ax, dy = by - ay, squared = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius - min[0]) / cell));
    const x1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + radius - min[0]) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - radius - min[1]) / cell));
    const y1 = Math.min(height - 1, Math.ceil((Math.max(ay, by) + radius - min[1]) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ox = min[0] + (x + 0.5) * cell - ax, oy = min[1] + (y + 0.5) * cell - ay;
      const t = squared ? Math.max(0, Math.min(1, (ox * dx + oy * dy) / squared)) : 0;
      if ((ox - dx * t) ** 2 + (oy - dy * t) ** 2 <= radius * radius) barrier[x + y * width] = 1;
    }
  }
  const original = components(mask, width, height);
  const remaining = components(mask.map((v, i) => v && !barrier[i] ? 1 : 0), width, height);
  const byOriginal = new Map();
  for (const group of remaining.groups) {
    const id = original.labels[group.first];
    if (!byOriginal.has(id)) byOriginal.set(id, []);
    byOriginal.get(id).push(group);
  }
  // Compare pieces of the same original shell, so a previous disconnected
  // detail cannot accidentally become the piece removed by a later stroke.
  const keep = new Set(); let split = false, removedArea = 0;
  for (const groups of byOriginal.values()) {
    groups.sort((a, b) => b.size - a.size);
    keep.add(groups[0].id);
    if (groups.length > 1 && groups[1].size >= 4) split = true;
    for (const group of groups.slice(1)) removedArea += group.size;
  }
  if (!split) return { valid: false, reason: 'Reach both edges or close the loop, then release.' };
  const classification = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  for (let i = 0; i < mask.length; i++) if (remaining.labels[i]) {
    classification[i] = keep.has(remaining.labels[i]) ? 1 : 2; queue[tail++] = i;
  }
  // Extend each piece into the empty background. This removes its whole
  // silhouette rather than leaving a thin rim around the vanished piece.
  while (head < tail) {
    const at = queue[head++], x = at % width, y = Math.floor(at / width);
    for (const next of [x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1, y > 0 ? at - width : -1, y + 1 < height ? at + width : -1]) {
      if (next >= 0 && !classification[next]) { classification[next] = classification[at]; queue[tail++] = next; }
    }
  }
  for (let i = 0; i < mask.length; i++) if (barrier[i] && mask[i]) classification[i] = 2;
  const distances = signedDistances(classification, width, height, cell);
  return { valid: true, closed, removedArea: removedArea * cell * cell,
    region: { min, width, height, cell, distances, eye: footprint.eye, planeZ: footprint.planeZ } };
}

function signedDistances(labels, width, height, cell) {
  const distances = new Float32Array(labels.length).fill(1000);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = x + y * width;
    if ((x && labels[i - 1] !== labels[i]) || (x + 1 < width && labels[i + 1] !== labels[i])
      || (y && labels[i - width] !== labels[i]) || (y + 1 < height && labels[i + width] !== labels[i])) distances[i] = 0.5;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = x + y * width;
    if (x) distances[i] = Math.min(distances[i], distances[i - 1] + 1);
    if (y) distances[i] = Math.min(distances[i], distances[i - width] + 1);
    if (x && y) distances[i] = Math.min(distances[i], distances[i - width - 1] + Math.SQRT2);
    if (x + 1 < width && y) distances[i] = Math.min(distances[i], distances[i - width + 1] + Math.SQRT2);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = x + y * width;
    if (x + 1 < width) distances[i] = Math.min(distances[i], distances[i + 1] + 1);
    if (y + 1 < height) distances[i] = Math.min(distances[i], distances[i + width] + 1);
    if (x + 1 < width && y + 1 < height) distances[i] = Math.min(distances[i], distances[i + width + 1] + Math.SQRT2);
    if (x && y + 1 < height) distances[i] = Math.min(distances[i], distances[i + width - 1] + Math.SQRT2);
  }
  for (let i = 0; i < distances.length; i++) distances[i] *= cell * (labels[i] === 2 ? 1 : -1);
  return distances;
}

export function cutDistance(x, y, z, region) {
  const [u, v] = projectCutPoint(x, y, z, region.eye, region.planeZ);
  const gx = Math.max(0, Math.min(region.width - 1.000001, (u - region.min[0]) / region.cell - 0.5));
  const gy = Math.max(0, Math.min(region.height - 1.000001, (v - region.min[1]) / region.cell - 0.5));
  const ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy, i = ix + iy * region.width;
  const d = region.distances;
  return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty)
    + (d[i + region.width] * (1 - tx) + d[i + region.width + 1] * tx) * ty;
}
