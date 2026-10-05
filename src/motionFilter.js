import * as THREE from 'three';

const alpha = (cutoff, dt) => 1 - Math.exp(-2 * Math.PI * cutoff * dt);
const middle = (a, b, c) => a + b + c - Math.min(a, b, c) - Math.max(a, b, c);

// A short median rejects isolated bad frames. Adaptive damping stays quiet at
// rest and opens up during intentional movement, without predicting past turns.
export class MotionFilter {
  constructor({ cutoff = 0.8, responsiveness = 2, deadband = 0.003, median = true } = {}) {
    Object.assign(this, { cutoff, responsiveness, deadband, median });
    this.reset();
  }

  reset() {
    this.history = [];
    this.value = null;
    this.previous = null;
    this.time = null;
    this.velocity = new THREE.Vector3();
  }

  update(point, now) {
    if (this.time === null || now - this.time > 300) this.reset();
    const dt = Math.max(1 / 240, Math.min(0.1, (now - (this.time ?? now - 16)) / 1000));
    this.time = now;
    this.history.push(point.clone());
    if (this.history.length > 3) this.history.shift();
    const sample = point.clone();
    if (this.median && this.history.length === 3) {
      for (const axis of ['x', 'y', 'z']) sample[axis] = middle(...this.history.map((p) => p[axis]));
    }
    if (!this.value) {
      this.value = sample.clone();
      this.previous = sample.clone();
      return this.value.clone();
    }
    const speed = sample.clone().sub(this.previous).multiplyScalar(1 / dt);
    this.velocity.lerp(speed, alpha(1, dt));
    this.previous.copy(sample);
    const distance = sample.distanceTo(this.value);
    if (distance > this.deadband) {
      const blend = alpha(this.cutoff + this.responsiveness * this.velocity.length(), dt);
      this.value.addScaledVector(sample.sub(this.value), blend * (1 - this.deadband / distance));
    }
    return this.value.clone();
  }
}
