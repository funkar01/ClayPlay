// Preserve bends in measured paths while bounding work per render frame.
export class StrokePath {
  constructor(step = 0.06) { this.step = step; this.clear(); }
  clear() { this.points = []; this.lastInput = null; }
  next(previous, target) {
    if (!this.lastInput || target.distanceTo(this.lastInput) >= 0.003) {
      this.points.push(target.clone()); this.lastInput = target.clone();
    }
    // An overloaded stroke pauses and rebases rather than bridging old motion.
    if (this.points.length > 48) { this.clear(); return null; }
    while (this.points.length && this.points[0].distanceTo(previous) < 0.003) this.points.shift();
    if (!this.points.length) return previous.clone();
    const delta = this.points[0].clone().sub(previous);
    if (delta.length() <= this.step) return this.points[0].clone();
    return previous.clone().add(delta.setLength(this.step));
  }
}
