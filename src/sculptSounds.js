const clamp = value => Math.max(0, Math.min(1, value));
export const SOUND_PROFILES = {
  pinch: { type: 'sine', base: 170, range: 260, wobble: 7, depth: 32 },
  extrude: { type: 'triangle', base: 110, range: 340, wobble: 11, depth: 45 },
  erase: { type: 'triangle', base: 390, range: -210, wobble: 28, depth: 85 },
  paint: { type: 'sine', base: 480, range: 240, wobble: 4, depth: 18 },
  cut: { type: 'triangle', base: 260, range: 200, wobble: 18, depth: 40 },
};

// One reusable voice, no recordings, audio nodes per frame, or mesh work.
export class SculptSounds {
  constructor({ createContext = () => new (window.AudioContext || window.webkitAudioContext)(), storage = globalThis.localStorage } = {}) {
    this.createContext = createContext; this.storage = storage; this.enabled = false;
    try { this.enabled = storage?.getItem('clayplay-sound') === 'on'; } catch {}
  }
  async unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const c = this.context = this.createContext();
        this.voice = c.createOscillator(); this.gain = c.createGain();
        this.wobble = c.createOscillator(); this.depth = c.createGain();
        this.gain.gain.value = 0;
        this.voice.connect(this.gain); this.gain.connect(c.destination);
        this.wobble.connect(this.depth); this.depth.connect(this.voice.frequency);
        this.voice.start(); this.wobble.start();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Sound support must never interrupt sculpting. */ }
  }
  toggle() {
    this.enabled = !this.enabled;
    try { this.storage?.setItem('clayplay-sound', this.enabled ? 'on' : 'off'); } catch {}
    this.stop(); if (this.enabled) this.unlock();
  }
  update(tool, point, amount = 0, now = performance.now()) {
    if (!this.enabled || !this.context || this.context.state !== 'running' || !point || !SOUND_PROFILES[tool]) { this.stop(); return; }
    const changed = tool !== this.tool;
    const dt = Math.max(.008, Math.min(.1, (now - (this.at ?? now)) / 1000));
    const distance = !changed && this.point ? Math.hypot(...point.map((v,i)=>v-this.point[i])) : 0;
    const speed = clamp(distance / dt / 2);
    const intensity = clamp(Math.max(amount / 1.5, speed));
    const p = SOUND_PROFILES[tool], t = this.context.currentTime;
    if (changed) this.voice.type = p.type;
    this.voice.frequency.setTargetAtTime(p.base + p.range * intensity, t, .065);
    this.wobble.frequency.setTargetAtTime(p.wobble + intensity * 7, t, .08);
    this.depth.gain.setTargetAtTime(p.depth * (.4 + intensity), t, .08);
    // Movement drives rubbing sounds; held pulls retain a quiet rubbery wobble.
    this.gain.gain.setTargetAtTime(Math.min(.075, .065 * (tool === 'pinch' ? .15 + intensity * .85 : speed)), t, .045);
    this.tool = tool; this.point = point; this.at = now;
  }
  stop() {
    if (this.context) this.gain?.gain.setTargetAtTime(0, this.context.currentTime, .035);
    this.tool = null; this.point = null; this.at = null;
  }
  dispose() { this.stop(); this.context?.close(); this.context = null; }
}
