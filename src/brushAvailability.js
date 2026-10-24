// Background work only changes the cue when it prevents this tool's next stroke.
export function brushApplying(volume, tool, { radius, eye, planeZ = .9, symmetry } = {}) {
  if (!['erase', 'extrude'].includes(tool) || volume.meshFailed) return false;
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
