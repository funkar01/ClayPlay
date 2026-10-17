import { palmCenter } from './twoHandScale.js';

function palmPosture(points, aspect) {
  const palm = palmCenter(points);
  if (!palm) return null;
  const distance = (a, b) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
  const width = distance(5, 17), length = Math.max(distance(0, 9), width * .6);
  if (length < .025) return null;
  const radius = Math.max(length * .95, width * .8);
  const fingers = [[6,8], [10,12], [14,16], [18,20]].map(([joint, tip]) => {
    const wrist = distance(tip, 0), knuckle = distance(joint, 0);
    const compact = Math.hypot((points[tip].x - palm.x) * aspect, points[tip].y - palm.y) < radius;
    return { curled: wrist < knuckle * .98 && compact, extended: wrist > knuckle * 1.08 };
  });
  const curled = fingers.slice(1).filter(f => f.curled).length;
  const extended = fingers.slice(1).filter(f => f.extended).length;
  return {
    // A fist often puts thumb and index in contact. Its whole-hand posture
    // wins regardless of that contact, allowing one noisy outer fingertip.
    closed: fingers[0].curled && curled >= 2,
    closing: curled >= 2,
    opening: fingers[0].extended || extended >= 2,
    open: !fingers[0].curled && extended >= 2
      && distance(4, 8) / Math.max(.025, width, length * .7) >= .55,
  };
}

export function closedPalm(points, aspect = 1) {
  return palmPosture(points, aspect)?.closed ?? false;
}

// Reserve the complete closure/opening sequence for Move. Neither fingertip
// overlap nor a noisy frame can turn a moving palm into a sculpting pinch.
export class PalmGesture {
  constructor() { this.reset(); }
  reset(blockUntilOpen = false) {
    this.blocked = blockUntilOpen; this.grip = false; this.openAt = null;
  }
  update(points, now, aspect = 1) {
    const pose = palmPosture(points, aspect);
    if (!pose) { this.openAt = null; this.grip = false; return { held: false, blocksPinch: true }; }
    if (pose.closed || pose.closing) this.blocked = true;
    if (!this.blocked) return { held: false, blocksPinch: false };
    if (pose.open) {
      this.grip = false; this.openAt ??= now;
      // Stop motion on the first open frame, then briefly confirm the open
      // hand before allowing a new pinch. This adds no delay to normal grabs.
      const released = now - this.openAt >= 60;
      if (released) this.blocked = false;
      return { held: false, blocksPinch: true, opening: !released, released };
    }
    this.openAt = null;
    if (pose.closed) this.grip = true;
    else if (pose.opening) this.grip = false;
    return { held: pose.closed || (this.grip && pose.closing && !pose.opening),
      blocksPinch: true, opening: pose.opening };
  }
}

export class PalmMove {
  constructor() { this.reset(); }
  reset(blockUntilOpen = false) {
    this.active = false; this.candidateAt = null; this.needsOpen = blockUntilOpen;
  }
  update(point, held, now, offset, canGrab = false, bounds = null) {
    if (!held || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      const finished = this.active; this.reset();
      return { phase: finished ? 'released' : 'waiting', offset, finished };
    }
    if (this.needsOpen) return { phase: 'waiting', offset };
    if (!this.active) {
      if (!canGrab) { this.candidateAt = null; return { phase: 'waiting', offset }; }
      this.candidateAt ??= now;
      if (now - this.candidateAt < 100) return { phase: 'ready', offset };
      this.active = true; this.origin = { x: point.x, y: point.y }; this.startOffset = [...offset];
      return { phase: 'holding', offset, started: true };
    }
    const target = [this.startOffset[0] + (point.x - this.origin.x), this.startOffset[1] + (point.y - this.origin.y)];
    if (bounds) for (let i = 0; i < 2; i++) target[i] = Math.max(bounds.min[i], Math.min(bounds.max[i], target[i]));
    return { phase: 'holding', offset: target };
  }
}
