// Image-space fist detection and resizing need only a few landmark distances.
// Keep intent separate from smoothing so opening either hand stops immediately.
export function palmCenter(points) {
  if (!points || points.length < 21 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const indices = [0, 5, 9, 13, 17];
  return { x: indices.reduce((sum, i) => sum + points[i].x, 0) / 5,
    y: indices.reduce((sum, i) => sum + points[i].y, 0) / 5 };
}

export function closedFist(points, aspect = 1, minimumCurled = 3) {
  const palm = palmCenter(points);
  if (!palm) return false;
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const length = distance(points[0], points[9]);
  if (length < 0.025) return false;
  let curled = 0, indexCurled = false;
  for (const [joint, tip] of [[6,8], [10,12], [14,16], [18,20]]) {
    if (distance(points[tip], points[0]) < distance(points[joint], points[0]) * 0.95
      && distance(points[tip], palm) < length * 0.85) {
      curled++;
      if (tip === 8) indexCurled = true;
    }
  }
  // A pointing index with relaxed outer fingers is still a sculpting pose.
  return indexCurled && curled >= minimumCurled;
}

export class TwoHandScale {
  constructor() { this.reset(); }
  reset() { this.active = false; this.candidateAt = null; this.distance = null; this.time = null; }
  update(hands, now, currentScale, aspect = 1, canStart = true) {
    const centers = hands.slice(0, 2).map(palmCenter);
    const held = hands.length === 2 && centers.every(Boolean) && hands.every(p => closedFist(p, aspect));
    const distance = held ? Math.hypot((centers[0].x - centers[1].x) * aspect, centers[0].y - centers[1].y) : 0;
    if (!held || distance < 0.08) {
      const finished = this.active; this.reset();
      return { phase: finished ? 'released' : 'waiting', scale: currentScale, finished, centers };
    }
    if (!this.active) {
      if (!canStart) { this.candidateAt = null; return { phase: 'waiting', scale: currentScale, centers }; }
      this.candidateAt ??= now;
      if (now - this.candidateAt < 120) return { phase: 'ready', scale: currentScale, centers };
      this.active = true; this.startScale = currentScale; this.startDistance = distance;
      this.distance = distance; this.time = now;
      return { phase: 'holding', scale: currentScale, started: true, centers };
    }
    const dt = Math.min(100, Math.max(0, now - this.time)); this.time = now;
    this.distance += (distance - this.distance) * (1 - Math.exp(-dt / 40));
    const scale = Math.max(0.4, Math.min(2.5, this.startScale * this.distance / this.startDistance));
    return { phase: 'holding', scale, centers };
  }
}

// Single-flight capture already prevents a backlog. Leave a small CPU margin
// without imposing the old 20 Hz ceiling on pointing in automatic two-hand mode.
export function handTrackingBudget(count, duration = 0) {
  return count === 2 ? { width: 512, interval: Math.max(33, Math.min(200, duration * 1.1)) }
    : { width: 640, interval: 0 };
}
