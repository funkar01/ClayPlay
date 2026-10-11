const blend = (cutoff, dt) => 1 - Math.exp(-2 * Math.PI * cutoff * dt);
const copy = points => points.map(p => ({ x: p.x, y: p.y, z: p.z }));

// One adaptive filter in normalized camera space. Slow movement is stabilized;
// intentional movement opens the cutoff rather than stacking more smoothing.
export class HandMotion {
  constructor({ minCutoff = 3, beta = 18, derivativeCutoff = 6,
    maxPredictionMs = 24, maxPredictionDistance = 0.015, staleMs = 100 } = {}) {
    Object.assign(this, { minCutoff, beta, derivativeCutoff, maxPredictionMs, maxPredictionDistance, staleMs });
    this.reset();
  }

  reset() { this.value = null; this.raw = null; this.velocity = null; this.previousSpeed = null; this.predictionVelocity = null; this.time = null; }

  update(points, sampleAt, receivedAt = sampleAt) {
    if (!Number.isFinite(sampleAt) || !points.length
      || points.some(p => !['x', 'y', 'z'].every(axis => Number.isFinite(p[axis])))) {
      this.reset(); return null;
    }
    if (!this.value || this.value.length !== points.length || sampleAt - this.time > this.staleMs) {
      this.value = copy(points); this.raw = copy(points);
      this.velocity = points.map(() => ({ x: 0, y: 0, z: 0 }));
      this.previousSpeed = copy(this.velocity); this.predictionVelocity = copy(this.velocity);
      this.time = sampleAt; this.receivedAt = receivedAt; this.period = 1000 / 30;
      return copy(this.value);
    }
    if (sampleAt <= this.time) return copy(this.value);
    const dt = Math.max(1 / 240, (sampleAt - this.time) / 1000);
    this.period = sampleAt - this.time;
    points.forEach((point, i) => {
      for (const axis of ['x', 'y', 'z']) {
        const speed = (point[axis] - this.raw[i][axis]) / dt;
        const previousSpeed = this.previousSpeed[i][axis];
        const old = speed * previousSpeed < 0 ? 0 : this.velocity[i][axis];
        // A stop or reversal must not retain the previous forward prediction.
        const stopped = Math.abs(speed) < 0.01 || speed * old < 0;
        this.velocity[i][axis] = stopped ? speed : old + (speed - old) * blend(this.derivativeCutoff, dt);
        // Require two movements in the same direction before extrapolating.
        // Alternating camera jitter must never be amplified by prediction.
        this.predictionVelocity[i][axis] = Math.abs(speed) >= .01 && speed * previousSpeed > 0 ? this.velocity[i][axis] : 0;
        this.previousSpeed[i][axis] = speed;
        const alpha = blend(this.minCutoff + this.beta * Math.abs(this.velocity[i][axis]), dt);
        this.value[i][axis] += (point[axis] - this.value[i][axis]) * alpha;
      }
    });
    this.raw = copy(points); this.time = sampleAt; this.receivedAt = receivedAt;
    return copy(this.value);
  }

  sample(now, { predict = true } = {}) {
    if (!this.value) return null;
    const age = Math.max(0, now - this.time);
    if (age >= this.staleMs) return copy(this.value);
    // Reconstruct motion between result arrivals. Basing this short horizon
    // only on capture age would exhaust it during inference, leaving steps.
    // Source age still determines staleness, independently of arrival time.
    const sinceArrival = Math.max(0, now - this.receivedAt);
    const horizon = predict ? Math.min(sinceArrival, this.period, this.maxPredictionMs) / 1000 : 0;
    return this.value.map((point, i) => {
      const v = this.predictionVelocity[i], distance = Math.hypot(v.x, v.y, v.z) * horizon;
      const scale = distance > this.maxPredictionDistance ? this.maxPredictionDistance / distance : 1;
      return { x: point.x + v.x * horizon * scale, y: point.y + v.y * horizon * scale,
        z: point.z + v.z * horizon * scale };
    });
  }
}
