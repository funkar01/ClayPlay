// Compose short invertible translations along the drag. Brush size controls
// the width, while total travel follows the hand rather than stopping early.
export function makeWarp(center, delta, radius, softness = 0.55, symmetry = false) {
  const support = Math.max(0, radius);
  const displacement = delta.map((v, i) => support ? Math.max(-2.35, Math.min(2.35, center[i] + v)) - center[i] : 0);
  // Mirrored halves meet at the center, rather than crossing through each other.
  if (symmetry && center[0] * (center[0] + displacement[0]) < 0) displacement[0] = -center[0];
  if (symmetry && Math.abs(center[0]) < 1e-8) displacement[0] = 0;
  const length = Math.hypot(...displacement);
  const falloff = 2 - Math.max(0, Math.min(1, softness));
  const count = support && length ? Math.ceil(length / (support / (symmetry ? 12 : 6))) : 0;
  const step = displacement.map(v => count ? v / count : 0);
  const steps = Array.from({ length: count }, (_, i) => ({ center: center.map((v, a) => v + step[a] * i), delta: step, support, falloff, symmetry }));
  return { center: [...center], delta: displacement, support, falloff, steps, symmetry };
}

export function warpWeight(x, y, z, warp) {
  if (warp.support <= 0) return 0;
  const r = Math.hypot(x - warp.center[0], y - warp.center[1], z - warp.center[2]) / warp.support;
  if (r >= 1) return 0;
  const t = Math.max(0, (r - 0.35) / 0.65);
  return (1 - t * t * (3 - 2 * t)) ** (warp.falloff ?? 1);
}

export function outsideStroke(x, y, z, warp) {
  return outsideCapsule(x, y, z, warp) && (!warp.symmetry || outsideCapsule(-x, y, z, warp));
}

function outsideCapsule(x, y, z, warp) {
  const ox = x - warp.center[0], oy = y - warp.center[1], oz = z - warp.center[2];
  const [dx, dy, dz] = warp.delta;
  const squaredLength = dx * dx + dy * dy + dz * dz;
  const t = squaredLength ? Math.max(0, Math.min(1, (ox * dx + oy * dy + oz * dz) / squaredLength)) : 0;
  return (ox - t * dx) ** 2 + (oy - t * dy) ** 2 + (oz - t * dz) ** 2 >= warp.support ** 2;
}

function forwardStep(x, y, z, warp) {
  if (warp.symmetry) {
    const a = warpWeight(x, y, z, warp), b = warpWeight(-x, y, z, warp);
    const weight = Math.max(a, b);
    return [x + warp.delta[0] * (a - b), y + warp.delta[1] * weight, z + warp.delta[2] * weight];
  }
  const weight = warpWeight(x, y, z, warp);
  return [x + warp.delta[0] * weight, y + warp.delta[1] * weight, z + warp.delta[2] * weight];
}

export function forwardWarp(x, y, z, warp) {
  if (warp.steps) {
    if (outsideStroke(x, y, z, warp)) return [x, y, z];
    let point = [x, y, z];
    for (const step of warp.steps) point = forwardStep(...point, step);
    return point;
  }
  return forwardStep(x, y, z, warp);
}

function inverseStep(x, y, z, warp) {
  let sx = x, sy = y, sz = z;
  for (let i = 0; i < 12; i++) {
    if (warp.symmetry) {
      const moved = forwardStep(sx, sy, sz, warp);
      const error = [moved[0] - x, moved[1] - y, moved[2] - z];
      if (Math.hypot(...error) < 1e-8) break;
      const correction = solve3(symmetryJacobian(sx, sy, sz, warp), error);
      sx -= correction[0]; sy -= correction[1]; sz -= correction[2];
      continue;
    }
    const weight = warpWeight(sx, sy, sz, warp);
    const error = [sx + warp.delta[0] * weight - x, sy + warp.delta[1] * weight - y, sz + warp.delta[2] * weight - z];
    if (Math.hypot(...error) < 1e-8) break;
    const g = weightGradient(sx, sy, sz, warp);
    const factor = dot(g, error) / (1 + dot(g, warp.delta));
    sx -= error[0] - warp.delta[0] * factor;
    sy -= error[1] - warp.delta[1] * factor;
    sz -= error[2] - warp.delta[2] * factor;
  }
  return [sx, sy, sz];
}

export function inverseWarp(x, y, z, warp) {
  if (warp.steps) {
    if (outsideStroke(x, y, z, warp)) return [x, y, z];
    let point = [x, y, z];
    for (let i = warp.steps.length - 1; i >= 0; i--) point = inverseStep(...point, warp.steps[i]);
    return point;
  }
  return inverseStep(x, y, z, warp);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function weightGradient(x, y, z, warp) {
  const offset = [x - warp.center[0], y - warp.center[1], z - warp.center[2]];
  const distance = Math.hypot(...offset);
  if (!distance || distance >= warp.support) return [0, 0, 0];
  const r = distance / warp.support, falloff = warp.falloff ?? 1;
  if (r <= 0.35) return [0, 0, 0];
  const t = (r - 0.35) / 0.65;
  const baseWeight = 1 - t * t * (3 - 2 * t);
  const scale = -6 * t * (1 - t) * falloff * baseWeight ** (falloff - 1) / (0.65 * warp.support * distance);
  return offset.map(v => v * scale);
}

function normalStep(x, y, z, normal, warp) {
  if (warp.symmetry) {
    const j = symmetryJacobian(x, y, z, warp);
    const result = solve3([j[0], j[3], j[6], j[1], j[4], j[7], j[2], j[5], j[8]], normal);
    const length = Math.hypot(...result) || 1;
    return result.map(v => v / length);
  }
  const gradient = weightGradient(x, y, z, warp);
  const scale = dot(warp.delta, normal) / (1 + dot(gradient, warp.delta));
  const result = normal.map((v, i) => v - gradient[i] * scale);
  const length = Math.hypot(...result) || 1;
  return result.map(v => v / length);
}

function symmetryJacobian(x, y, z, warp) {
  const a = warpWeight(x, y, z, warp), b = warpWeight(-x, y, z, warp);
  const ga = weightGradient(x, y, z, warp), gb = weightGradient(-x, y, z, warp);
  gb[0] = -gb[0];
  // max keeps overlapping vertical pulls at one brush's strength. At the
  // equal-weight seam use the symmetric gradient, including on the axis.
  const g = Math.abs(a - b) < 1e-12 ? ga.map((v, i) => (v + gb[i]) / 2) : a > b ? ga : gb;
  const [dx, dy, dz] = warp.delta;
  return [1 + dx * (ga[0] - gb[0]), dx * (ga[1] - gb[1]), dx * (ga[2] - gb[2]),
    dy * g[0], 1 + dy * g[1], dy * g[2], dz * g[0], dz * g[1], 1 + dz * g[2]];
}

function solve3(m, b) {
  const [a, c, d, e, f, g, h, i, j] = m;
  const A = f * j - g * i, B = d * i - c * j, C = c * g - d * f;
  const D = g * h - e * j, E = a * j - d * h, F = d * e - a * g;
  const G = e * i - f * h, H = c * h - a * i, I = a * f - c * e;
  const determinant = a * A + c * D + d * G;
  return [(A * b[0] + B * b[1] + C * b[2]) / determinant,
    (D * b[0] + E * b[1] + F * b[2]) / determinant,
    (G * b[0] + H * b[1] + I * b[2]) / determinant];
}

// The worker evaluates position and normal together to avoid traversing a
// mirrored stroke twice for every vertex.
export function warpVertex(x, y, z, normal, warp) {
  let point = [x, y, z], result = [...normal];
  for (const step of warp.steps ?? [warp]) {
    const [px, py, pz] = point, [cx, cy, cz] = step.center;
    const yz = (py - cy) ** 2 + (pz - cz) ** 2, radius2 = step.support ** 2;
    if ((px - cx) ** 2 + yz >= radius2 && (!step.symmetry || (px + cx) ** 2 + yz >= radius2)) continue;
    result = normalStep(...point, result, step);
    point = forwardStep(...point, step);
  }
  return { point, normal: result };
}

export function warpNormal(x, y, z, normal, warp) {
  if (!warp.steps) return normalStep(x, y, z, normal, warp);
  if (outsideStroke(x, y, z, warp)) return [...normal];
  let point = [x, y, z], result = [...normal];
  for (const step of warp.steps) {
    result = normalStep(...point, result, step);
    point = forwardStep(...point, step);
  }
  return result;
}
