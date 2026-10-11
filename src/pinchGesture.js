// Gesture intent has its own short filter, independent of visual finger lag.
export class PinchGesture {
  reset() { this.held = false; this.ratio = null; this.candidateAt = null; this.time = null; }
  constructor() { this.reset(); }
  update(points, now, aspect = 1) {
    // Visible fingertip separation is more dependable for intent than noisy
    // inferred depth while thumb and index overlap in a real pinch.
    const distance = (a, b) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
    const ratio = distance(4, 8) / Math.max(0.025, distance(5, 17), distance(0, 9) * 0.7);
    // A clearly closed pinch starts on this frame. Only borderline closure
    // needs the short confirmation below; the palm gesture owns actual fists.
    if (!this.held && ratio < .34) {
      this.held = true; this.ratio = ratio; this.candidateAt = null; this.time = now;
      return true;
    }
    // Release on the first clearly open image frame. Filtering and a long
    // release dwell let the newly extended index keep dragging the patch.
    if (this.held && ratio >= 0.55) {
      this.held = false; this.ratio = ratio; this.candidateAt = null; this.time = now;
      return false;
    }
    const dt = Math.min(0.1, Math.max(0.001, (now - (this.time ?? now - 33)) / 1000));
    this.time = now;
    this.ratio = this.ratio === null ? ratio : this.ratio + (ratio - this.ratio) * (1 - Math.exp(-dt / 0.02));
    const change = !this.held && ratio < 0.42 && this.ratio < 0.42;
    if (!change) this.candidateAt = null;
    else {
      this.candidateAt ??= now;
      if (now - this.candidateAt >= 30) { this.held = true; this.candidateAt = null; }
    }
    return this.held;
  }
  uncertain() { this.candidateAt = null; this.time = null; }
}
