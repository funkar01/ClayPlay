// Compose short invertible translations along the drag. Brush size controls
// the width, while total travel follows the hand rather than stopping early.
export function makeWarp(center, delta, radius, softness = 0.55) {
  const support = Math.max(0, radius);
  const displacement = delta.map((v, i) => support ? Math.max(-2.35, Math.min(2.35, center[i] + v)) - center[i] : 0);
  const length = Math.hypot(...displacement);
  const falloff = 2 - Math.max(0, Math.min(1, softness));
  const count = support && length ? Math.ceil(length / (support / 6)) : 0;
  const step = displacement.map(v => count ? v / count : 0);
  const steps = Array.from({ length: count }, (_, i) => ({ center: center.map((v, a) => v + step[a] * i), delta: step, support, falloff }));
  return { center: [...center], delta: displacement, support, falloff, steps };
}

export function warpWeight(x, y, z, warp) {
  if (warp.support <= 0) return 0;
  const r = Math.hypot(x - warp.center[0], y - warp.center[1], z - warp.center[2]) / warp.support;
  if (r >= 1) return 0;
  const t = Math.max(0, (r - 0.35) / 0.65);
  return (1 - t * t * (3 - 2 * t)) ** (warp.falloff ?? 1);
}

export function outsideStroke(x, y, z, warp) {
  const ox = x - warp.center[0], oy = y - warp.center[1], oz = z - warp.center[2];
  const [dx, dy, dz] = warp.delta;
  const squaredLength = dx * dx + dy * dy + dz * dz;
  const t = squaredLength ? Math.max(0, Math.min(1, (ox * dx + oy * dy + oz * dz) / squaredLength)) : 0;
  return (ox - t * dx) ** 2 + (oy - t * dy) ** 2 + (oz - t * dz) ** 2 >= warp.support ** 2;
}

function forwardStep(x, y, z, warp) {
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
  const gradient = weightGradient(x, y, z, warp);
  const scale = dot(warp.delta, normal) / (1 + dot(gradient, warp.delta));
  const result = normal.map((v, i) => v - gradient[i] * scale);
  const length = Math.hypot(...result) || 1;
  return result.map(v => v / length);
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
