// Background work only changes the cue when it prevents this tool's next stroke.
export function brushApplying(volume, tool, { radius, eye, planeZ = .9, symmetry } = {}) {
  if (volume.meshFailed) return false;
  if (['pinch', 'paint', 'cut'].includes(tool)) {
    if (tool === 'pinch' && volume.surfacePull?.active && !volume.surfacePull.released) return false;
    if (tool === 'paint' && volume.surfacePaint?.active) return false;
    return Boolean(volume.pulling || volume.cutting || volume.erasing || volume.meshQueue?.pending);
  }
  if (!['erase', 'extrude'].includes(tool)) return false;
  if (tool === 'extrude') {
    const extrude = volume.surfaceExtrude;
    if (extrude?.active) return false;
    return Boolean(volume.pulling || volume.cutting || (extrude?.queue.length >= 4)
      || (volume.meshQueue?.pending && !extrude?.canBegin));
  }
  const erase = volume.surfaceErase;
  if (erase?.active) {
    if (!erase.released) return false;
    return radius !== erase.radius || planeZ !== erase.planeZ || symmetry !== erase.symmetry
      || !eye || eye.some((n, i) => Math.abs(n - erase.eye[i]) > .0001);
  }
  return Boolean(volume.pulling || volume.cutting || volume.meshQueue?.pending);
}

// A live, responsive drag is not a wait. Track authoritative work separately
// from availability: erase/extrude can queue a new stroke while still applying.
export function deformationApplying(volume) {
  if (volume.meshFailed) return false;
  const pull = volume.surfacePull, erase = volume.surfaceErase, extrude = volume.surfaceExtrude;
  return Boolean(volume.meshQueue?.pending || pull?.busy
    || (volume.pulling && !pull?.active && !extrude?.active)
    || (volume.cutting && !erase?.active)
    || erase?.busy || erase?.pending?.length || (erase?.active && erase.released)
    || extrude?.committing || extrude?.queue?.length);
}
