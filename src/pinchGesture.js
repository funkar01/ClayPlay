// Gesture intent has its own short filter, independent of visual finger lag.
export class PinchGesture {
  reset() { this.held = false; this.ratio = null; this.candidateAt = null; this.time = null; }
  constructor() { this.reset(); }
  update(points, now) {
    const distance = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y, points[a].z - points[b].z);
    const ratio = distance(4, 8) / Math.max(0.025, distance(5, 17));
    const dt = Math.min(0.1, Math.max(0.001, (now - (this.time ?? now - 33)) / 1000));
    this.time = now;
    this.ratio = this.ratio === null ? ratio : this.ratio + (ratio - this.ratio) * (1 - Math.exp(-dt / 0.035));
    const change = this.held ? this.ratio > 0.58 : this.ratio < 0.38;
    if (!change) this.candidateAt = null;
    else {
      this.candidateAt ??= now;
      if (now - this.candidateAt >= (this.held ? 95 : 55)) { this.held = !this.held; this.candidateAt = null; }
    }
    return this.held;
  }
  uncertain() { this.candidateAt = null; this.time = null; }
}
