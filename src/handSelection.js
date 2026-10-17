// Dwell runs only on fresh tracking frames. A completed selection stays
// latched until the finger leaves, even if the action rebuilds the menu.
export class HandSelection {
  constructor() { this.reset(); }
  cancel() { this.hover = null; this.hoverAt = 0; this.lastAt = null; this.pausedAt = null; }
  reset() { this.cancel(); this.latched = null; }
  pause(now) {
    // A brief detector miss freezes dwell at the last confirmed sample. It
    // cannot count unseen time toward a click or erase an almost-finished hold.
    if (this.lastAt === null) return;
    this.pausedAt ??= this.lastAt;
    if (now - this.pausedAt > 450) this.cancel();
  }
  update({ point, target = null, key = target, bounds = null, fist = false,
    blocked = false, modal = false, now }) {
    if (!point || blocked) {
      this.cancel();
      return { owns: modal, phase: 'waiting', progress: 0 };
    }
    if (this.pausedAt !== null) {
      if (now - this.pausedAt > 450) this.cancel();
      else { this.hoverAt += now - this.pausedAt; this.pausedAt = null; }
    } else if (this.lastAt !== null && now - this.lastAt > 300) this.cancel();
    this.lastAt = now;
    if (this.latched) {
      const b = this.latched.bounds;
      const inside = b ? point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom : key === this.latched.key;
      if (inside) return { owns: true, phase: 'selected', target: key === this.latched.key ? target : null, progress: 1 };
      this.latched = null;
    }
    if (fist) {
      this.cancel();
      return { owns: modal || Boolean(target), phase: 'point', target, progress: 0 };
    }
    if (!target) {
      this.cancel();
      return { owns: modal, phase: 'waiting', progress: 0 };
    }
    if (key !== this.hover) { this.hover = key; this.hoverAt = now; }
    const progress = Math.min(1, Math.max(0, (now - this.hoverAt) / (this.dwellMs ?? 500)));
    if (progress === 1) {
      this.latched = { key, bounds };
      this.cancel();
      return { owns: true, phase: 'selected', activated: target, target, progress };
    }
    return { owns: true, phase: 'dwell', target, progress };
  }
}

// Match the same physical hand across detector ordering changes. A missing
// controlling hand briefly reserves ownership instead of jumping to another.
export class ControlHand {
  constructor({ graceMs = 300 } = {}) { this.graceMs = graceMs; this.reset(); }
  reset() { this.previous = null; this.lastAt = 0; }
  choose(candidates, now) {
    if (!candidates.length) { if (now - this.lastAt > this.graceMs) this.reset(); return null; }
    let chosen = candidates[0];
    if (this.previous) {
      const ranked = candidates.map(candidate => ({ candidate,
        distance: Math.hypot(candidate.palm.x - this.previous.palm.x, candidate.palm.y - this.previous.palm.y)
          + (candidate.label && this.previous.label && candidate.label !== this.previous.label ? .35 : 0) }))
        .sort((a, b) => a.distance - b.distance);
      const sameLabel = this.previous.label && ranked[0].candidate.label === this.previous.label;
      if (!sameLabel && ranked[0].distance > .3 && now - this.lastAt < this.graceMs) return null;
      chosen = ranked[0].candidate;
    }
    const changed = Boolean(this.previous && chosen.label && this.previous.label && chosen.label !== this.previous.label);
    this.previous = chosen; this.lastAt = now;
    return { ...chosen, changed };
  }
}
