import * as THREE from 'three';
import { MotionFilter } from './motionFilter.js';

const PALM = [0, 5, 9, 13, 17];
const EDGES = [[0, 5], [0, 9], [0, 13], [0, 17], [5, 17]];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const center = (points) => PALM.reduce((sum, i) => sum.add(new THREE.Vector3(points[i].x, points[i].y, points[i].z)), new THREE.Vector3()).multiplyScalar(1 / PALM.length);

export class ReachCalibration {
  constructor(onChange) {
    this.onChange = onChange;
    this.panel = document.querySelector('#reach-calibration');
    this.button = document.querySelector('#capture-reach');
    this.copy = document.querySelector('#reach-copy');
    this.status = document.querySelector('#reach-status');
    this.label = document.querySelector('#reach-label');
    this.depthLabel = document.querySelector('#reach-depth-label');
    this.marker = document.querySelector('#reach-marker');
    this.button.addEventListener('click', () => this.capture());
    this.panel.addEventListener('toggle', () => {
      if (this.panel.open) document.querySelector('#clay-menu').open = false;
      onChange();
    });
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.panel.open) {
        event.stopPropagation();
        this.panel.open = false;
        this.panel.querySelector('summary').focus();
      }
    });
    this.reset();
  }

  get ready() { return Boolean(this.near && this.far); }
  get canSculpt() { return this.ready && this.valid && !this.depthUncertain && !this.panel.open && !this.capturing; }

  reset() {
    this.depthUncertain = false;
    this.resetMotion();
    this.near = null;
    this.far = null;
    this.latest = null;
    this.valid = false;
    this.capturing = false;
    this.samples = [];
    this.filteredPose = null;
    this.filteredRoot = null;
    this.reach = 0;
    this.button.disabled = true;
    this.button.textContent = 'Capture near position';
    this.label.textContent = 'Calibrate reach';
    this.copy.textContent = 'Start your camera. Hold an open palm near your body, with your wrist visible. Clay will be centered halfway along your calibrated reach.';
    this.status.textContent = 'Camera and hand needed';
    this.depthLabel.textContent = 'Calibrate to place your hand';
    this.marker.hidden = true;
    document.querySelector('#reach-contact').textContent = 'Calibrate before sculpting';
    document.querySelector('#reach-contact').dataset.contact = 'false';
  }

  capture() {
    if (!this.latest || performance.now() - this.latest.time > 300) return;
    if (this.ready) {
      this.near = null;
      this.far = null;
      this.filteredPose = null;
      this.filteredRoot = null;
      this.copy.textContent = 'Hold your open palm near your body. Keep this same hand and palm orientation for both positions.';
    }
    this.onChange();
    this.resetMotion();
    this.capturing = true;
    this.captureHand = this.latest.hand;
    this.start = performance.now();
    this.samples = [];
    this.button.disabled = true;
    this.button.textContent = 'Get your hand into position…';
    this.label.textContent = 'Calibrating…';
  }

  loseHand(now) {
    this.valid = false;
    this.latest = null;
    this.samples = [];
    // Keep a short dropout's filter history; tools pause immediately regardless.
    if (now - (this.lastMappedAt ?? 0) > 300) this.resetMotion();
    this.marker.hidden = true;
    this.button.disabled = true;
    this.status.textContent = 'Show the same hand, with the palm and wrist visible.';
    this.depthLabel.textContent = 'Hand out of view';
    this.checkTimeout(now);
  }

  checkTimeout(now) {
    if (this.capturing && now - this.start > 12000) {
      this.capturing = false;
      this.samples = [];
      this.button.disabled = !this.latest;
      this.button.textContent = this.near ? 'Retry forward position' : 'Retry near position';
      this.status.textContent = 'Could not get a steady sample. Hold your palm still and try again.';
    }
  }

  observe(image, world, handedness, aspect, now) {
    this.depthUncertain = false;
    if (!world || world.length !== 21 || !world.every((p) => Number.isFinite(p.x + p.y + p.z))) {
      this.loseHand(now);
      return;
    }
    const ratios = [];
    for (const [a, b] of EDGES) {
      const projected = Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
      if (projected > 0.018) ratios.push(Math.hypot((image[a].x - image[b].x) * aspect, image[a].y - image[b].y) / projected);
    }
    const inFrame = PALM.every((i) => image[i].x > 0.025 && image[i].x < 0.975 && image[i].y > 0.025 && image[i].y < 0.975);
    if (ratios.length < 3 || !inFrame) { this.holdDepth(handedness, now); return; }
    const signal = median(ratios);
    if (!Number.isFinite(signal) || signal <= 0) { this.holdDepth(handedness, now); return; }
    const palm = center(image);
    const width = new THREE.Vector3().subVectors(world[5], world[17]).length();
    if (width < 0.025 || width > 0.16) { this.holdDepth(handedness, now); return; }
    this.latest = { distance: 1 / signal, x: (palm.x - 0.5) * aspect / signal, y: (palm.y - 0.5) / signal, width, hand: handedness, time: now };
    if (this.capturing && handedness !== this.captureHand) {
      this.capturing = false;
      this.samples = [];
      this.copy.textContent = 'The tracked hand changed during capture. Use one hand for both positions, then try again.';
      this.button.textContent = this.near ? 'Retry forward position' : 'Retry near position';
    }
    this.valid = !this.near || this.near.hand === handedness;
    if (!this.valid) {
      this.resetMotion();
      this.status.textContent = 'Use your calibrated hand, or recalibrate for this hand.';
      this.depthLabel.textContent = 'Different hand — sculpting paused';
      this.marker.hidden = true;
      this.button.disabled = !this.ready;
      this.samples = [];
      this.checkTimeout(now);
      return;
    }
    if (!this.ready) this.depthLabel.textContent = this.capturing ? 'Capturing your reach…' : 'Hand detected · calibration needed';
    if (this.capturing) {
      const elapsed = now - this.start;
      if (elapsed < 1800) {
        this.button.textContent = `Hold your pose in ${Math.ceil((1800 - elapsed) / 1000)}…`;
      } else {
        this.samples.push(this.latest);
        this.samples = this.samples.filter((sample) => now - sample.time < 1400);
        this.button.textContent = 'Hold still…';
        if (this.samples.length >= 18 && now - this.samples[0].time > 950) this.finishCapture();
      }
      this.checkTimeout(now);
    } else {
      this.button.disabled = false;
      if (!this.ready) this.status.textContent = this.near ? 'Reach toward the screen, farther from your eyes. Keep the same open palm.' : 'Hand in view. Capture your comfortable near-body position.';
    }
  }

  finishCapture() {
    const distances = this.samples.map((sample) => sample.distance);
    const distance = median(distances);
    if (Math.max(...distances) - Math.min(...distances) > distance * 0.12) return;
    const sample = { distance, x: median(this.samples.map((s) => s.x)), y: median(this.samples.map((s) => s.y)), width: median(this.samples.map((s) => s.width)), hand: this.latest.hand };
    this.capturing = false;
    this.button.disabled = false;
    if (!this.near) {
      this.near = sample;
      this.copy.textContent = 'Now reach comfortably toward the screen, away from your body. Keep the same open palm facing the camera. This marks the far side of your workspace.';
      this.button.textContent = 'Capture forward position';
      this.label.textContent = 'Set forward reach';
    } else if (sample.distance > this.near.distance * 0.83) {
      this.status.textContent = 'Move farther toward the camera, keeping the same palm angle, then retry.';
      this.button.textContent = 'Retry forward position';
      this.copy.textContent = 'The two positions were too similar or reversed. Keep your body still and extend your hand toward the screen.';
    } else {
      this.far = sample;
      this.filteredRoot = null;
      this.filteredPose = null;
      this.copy.textContent = 'Reach halfway between your two positions to find the clay center. The green contact cue shows when a fingertip touches clay. Recalibrate if you move your chair or camera.';
      this.status.textContent = 'Reach calibrated. Move your fingertips to the clay to sculpt.';
      this.label.textContent = 'Reach calibrated';
      this.button.textContent = 'Recalibrate reach';
      this.onChange();
      // Completing setup must release the panel's sculpting gate.
      this.panel.open = false;
      this.panel.querySelector('summary').focus({ preventScroll: true });
    }
    this.samples = [];
  }

  map(world, now) {
    if (!this.ready || !this.valid || !this.latest || this.capturing) return null;
    const range = this.near.distance - this.far.distance;
    const rawReach = (this.near.distance - this.latest.distance) / range;
    const targetReach = THREE.MathUtils.clamp(rawReach, -0.08, 1.08);
    const scale = 0.65 / ((this.near.width + this.far.width) / 2);
    const originX = (this.near.x + this.far.x) / 2;
    const originY = (this.near.y + this.far.y) / 2;
    const root = new THREE.Vector3(-(this.latest.x - originX) * scale, -(this.latest.y - originY) * scale, 2.4 - targetReach * 4.8);
    root.x = THREE.MathUtils.clamp(root.x, -3.2, 3.2);
    root.y = THREE.MathUtils.clamp(root.y, -2.1, 2.1);
    if (this.lastMappedAt && now - this.lastMappedAt > 300) this.onChange();
    this.lastMappedAt = now;
    this.filteredRoot = this.rootFilter.update(new THREE.Vector3(root.x, root.y, 0), now);
    this.filteredRoot.z = this.depthFilter.update(new THREE.Vector3(0, 0, root.z), now).z;
    const palm = center(world);
    const local = world.map((p) => new THREE.Vector3(-(p.x - palm.x), -(p.y - palm.y), p.z - palm.z).multiplyScalar(scale));
    this.filteredPose = local.map((p, i) => this.poseFilters[i].update(p, now));
    this.reach = (2.4 - this.filteredRoot.z) / 4.8;
    this.marker.hidden = false;
    this.marker.style.left = `${THREE.MathUtils.clamp(this.reach, 0, 1) * 100}%`;
    this.depthLabel.textContent = this.reach < 0.43 ? 'Your hand · nearer to you' : this.reach > 0.57 ? 'Your hand · beyond center' : 'Your hand · at clay center';
    if (this.depthUncertain) this.depthLabel.textContent = 'Hold steady · checking depth';
    if (!this.panel.open) this.status.textContent = 'Calibrated for this hand. Recalibrate after moving your chair or camera.';
    return this.filteredPose.map((p) => p.clone().add(this.filteredRoot));
  }

  resetMotion() {
    this.filteredRoot = null;
    this.filteredPose = null;
    this.rootFilter = new MotionFilter({ cutoff: 2.2, responsiveness: 2.2, deadband: 0.001, median: false });
    this.depthFilter = new MotionFilter({ cutoff: 1.4, responsiveness: 1.8, deadband: 0.004 });
    this.poseFilters = Array.from({ length: 21 }, () => new MotionFilter({ cutoff: 3, responsiveness: 3, deadband: 0, median: false }));
    this.lastMappedAt = null;
  }

  holdDepth(handedness, now) {
    if (this.ready && this.latest && this.near.hand === handedness && now - this.latest.time <= 180) {
      this.valid = true;
      this.depthUncertain = true;
      this.depthLabel.textContent = 'Hold steady · checking depth';
    } else this.loseHand(now);
  }
}
