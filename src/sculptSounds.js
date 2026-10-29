const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .35;
// A short note per successful edit; musical intervals keep the palette playful.
export const SOUND_PROFILES = {
  pull: { type: 'sine', midi: 60, duration: .26 },
  extrude: { type: 'triangle', midi: 67, duration: .30 },
  paint: { type: 'sine', midi: 76, duration: .19 },
  erase: { type: 'triangle', midi: 57, duration: .16 },
  cut: { type: 'triangle', midi: 72, duration: .14 },
  move: { type: 'sine', midi: 62, duration: .18 },
  resize: { type: 'sine', midi: 65, duration: .25 },
  undo: { type: 'sine', midi: 55, duration: .16 },
  redo: { type: 'sine', midi: 79, duration: .16 },
};

export function editNote(tool, intensity = .35) {
  const profile = SOUND_PROFILES[tool === 'pinch' ? 'pull' : tool];
  if (!profile) return null;
  const amount = clamp(intensity);
  const interval = [0, 2, 4, 7][Math.min(3, Math.floor(amount * 4))];
  return { type: profile.type, frequency: 440 * 2 ** ((profile.midi + interval - 69) / 12),
    volume: .035 + amount * .035, duration: profile.duration + amount * .04 };
}

// No per-frame sound or delayed playback queue. Sound only plays after a
// user gesture unlocks audio; muted, suspended and background edits stay quiet.
export class SculptSounds {
  constructor({ createContext = () => new (window.AudioContext || window.webkitAudioContext)(), storage = globalThis.localStorage } = {}) {
    this.createContext = createContext; this.storage = storage; this.enabled = true; this.notes = new Set();
    try { this.enabled = storage?.getItem('clayplay-sound') !== 'off'; } catch {}
  }
  async unlock() {
    if (!this.enabled || this.disposed) return;
    try {
      this.context ??= this.createContext();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Audio must never interrupt sculpting. */ }
  }
  toggle() {
    this.enabled = !this.enabled;
    try { this.storage?.setItem('clayplay-sound', this.enabled ? 'on' : 'off'); } catch {}
    this.stop(); if (this.enabled) this.unlock();
  }
  play(tool, intensity = .35) {
    const note = editNote(tool, intensity), c = this.context;
    if (!this.enabled || this.disposed || !note || c?.state !== 'running') return false;
    let voice, gain;
    try {
      if (this.notes.size >= 3) this.silence(this.notes.values().next().value);
      voice = c.createOscillator(); gain = c.createGain();
      const active = { voice, gain }; this.notes.add(active);
      voice.type = note.type; voice.frequency.setValueAtTime(note.frequency, c.currentTime);
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(note.volume, c.currentTime + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, c.currentTime + note.duration);
      voice.connect(gain); gain.connect(c.destination);
      voice.onended = () => { this.notes.delete(active); voice.disconnect(); gain.disconnect(); };
      voice.start(c.currentTime); voice.stop(c.currentTime + note.duration + .015);
      return true;
    } catch {
      try { voice?.disconnect(); gain?.disconnect(); } catch {}
      for (const active of this.notes) if (active.voice === voice) this.notes.delete(active);
      return false;
    }
  }
  silence(active) {
    if (!active) return;
    this.notes.delete(active);
    try {
      const t = this.context.currentTime;
      active.gain.gain.cancelScheduledValues(t);
      active.gain.gain.setTargetAtTime(0, t, .005);
      active.voice.stop(t + .025);
    } catch {}
  }
  stop() { for (const note of [...this.notes]) this.silence(note); }
  dispose() { this.stop(); this.disposed = true; this.context?.close(); this.context = null; }
}
