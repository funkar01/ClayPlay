// Match CSS object-fit: cover and the mirrored front-camera image, including
// both horizontal and vertical cropping. Keep offscreen coordinates unclamped.
export function cameraCoverPoint(point, sourceWidth, sourceHeight, viewWidth, viewHeight) {
  const sourceAspect = sourceWidth / sourceHeight, viewAspect = viewWidth / viewHeight;
  const sx = Math.max(1, sourceAspect / viewAspect), sy = Math.max(1, viewAspect / sourceAspect);
  return { x: (1 - point.x) * sx - (sx - 1) / 2, y: point.y * sy - (sy - 1) / 2 };
}

export class CameraBackdrop {
  constructor({ video, button, stage, scene, renderer, onChange, onError }) {
    Object.assign(this, { video, button, stage, scene, renderer, onChange, onError });
    this.background = scene.background; this.enabled = false; this.live = false; this.version = 0;
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.version++; this.video.pause(); this.video.srcObject = null; this.video.hidden = true;
    }
    this.button.setAttribute('aria-pressed', String(enabled));
    this.button.classList.toggle('is-active', enabled);
    this.update(); this.updateLabel();
  }
  async attachStream(stream) {
    if (!this.enabled || !stream) return;
    const version = ++this.version;
    this.video.srcObject = stream; this.video.hidden = false;
    try {
      await this.video.play();
      if (version === this.version) this.update();
    } catch (error) {
      if (version !== this.version) return;
      this.setEnabled(false); this.onError(error);
    }
  }
  updateLabel() {
    this.button.querySelector('.ar-state').textContent = this.enabled ? this.live ? 'On' : 'Starting…' : 'Off';
  }
  update() {
    const live = Boolean(this.enabled && this.video.srcObject && !this.video.paused && this.video.readyState >= 2);
    if (live === this.live) return;
    this.live = live;
    this.scene.background = live ? null : this.background;
    this.renderer.setClearAlpha(live ? 0 : 1);
    this.stage.classList.toggle('is-ar', live);
    this.updateLabel(); this.onChange();
  }
}
