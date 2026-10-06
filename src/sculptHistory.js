import * as THREE from 'three';

function capture(volume) {
  return { state: volume.snapshot(), bricks: [...volume.bricks].map(([key, { mesh }]) => ({ key,
    positions: mesh.geometry.attributes.position.array.slice(), normals: mesh.geometry.attributes.normal.array.slice() })) };
}

export function checkpoint(volume) {
  volume.undoStack ??= []; volume.redoStack = [];
  volume.undoStack.push(capture(volume));
  if (volume.undoStack.length > 8) volume.undoStack.shift();
  document.dispatchEvent(new Event('sculpt-history-change'));
}

export function restoreHistory(volume, redo = false) {
  if (volume.pulling || volume.cutting || volume.meshQueue?.pending) return false;
  const from = redo ? volume.redoStack : volume.undoStack;
  if (!from?.length) return false;
  const to = redo ? (volume.undoStack ??= []) : (volume.redoStack ??= []);
  to.push(capture(volume));
  const saved = from.pop();
  Object.assign(volume, { shape: saved.state.shape, field: new Map(saved.state.field),
    pullSource: saved.state.pullSource, pullWarp: saved.state.pullWarp,
    cutSource: saved.state.cutSource, cutRegion: saved.state.cutRegion });
  volume.meshQueue?.invalidate();
  for (const { mesh } of volume.bricks.values()) { volume.parent.remove(mesh); mesh.geometry.dispose(); }
  volume.bricks.clear();
  for (const brick of saved.bricks) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(brick.positions.slice(), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(brick.normals.slice(), 3));
    const mesh = new THREE.Mesh(geometry, volume.material);
    mesh.name = `ClayBrick_${brick.key}`;
    volume.parent.add(mesh); volume.bricks.set(brick.key, { mesh });
  }
  document.dispatchEvent(new Event('sculpt-history-change'));
  return true;
}
