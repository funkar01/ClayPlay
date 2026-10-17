import * as THREE from 'three';
import { refreshPaint,applyVertexPaint } from './paintLayer.js';

export function checkpointPaint(volume,changes) {
  volume.undoStack ??=[];volume.redoStack=[];
  volume.undoStack.push({paintOnly:true,changes:new Map(changes)});
  if(volume.undoStack.length>8)volume.undoStack.shift();
  document.dispatchEvent(new Event('sculpt-history-change'));
}

function capture(volume) {
  return { userScale: volume.userScale ?? 1, userOffset: [...(volume.userOffset ?? [0, 0])], state: volume.snapshot(), bricks: [...volume.bricks].map(([key, { mesh }]) => ({ key,
    positions: mesh.geometry.attributes.position.array.slice(), normals: mesh.geometry.attributes.normal.array.slice() })) };
}

export function applyMaskScale(volume, scale) {
  volume.userScale = scale;
  volume.parent.scale.setScalar((volume.layoutScale ?? 1) * scale);
  volume.parent.updateMatrixWorld(true);
}

export function checkpointScale(volume) {
  volume.undoStack ??= []; volume.redoStack = [];
  volume.undoStack.push({ scaleOnly: true, userScale: volume.userScale ?? 1 });
  if (volume.undoStack.length > 8) volume.undoStack.shift();
  document.dispatchEvent(new Event('sculpt-history-change'));
}

export function applyMaskPosition(volume, offset) {
  volume.userOffset = [...offset];
  const base = volume.layoutPosition ?? [0, 0, 0];
  volume.parent.position.set(base[0] + offset[0], base[1] + offset[1], base[2]);
  volume.parent.updateMatrixWorld(true);
}

export function checkpointPosition(volume) {
  volume.undoStack ??= []; volume.redoStack = [];
  volume.undoStack.push({ positionOnly: true, userOffset: [...(volume.userOffset ?? [0, 0])] });
  if (volume.undoStack.length > 8) volume.undoStack.shift();
  document.dispatchEvent(new Event('sculpt-history-change'));
}

export function checkpoint(volume) {
  volume.undoStack ??= []; volume.redoStack = [];
  volume.undoStack.push(capture(volume));
  if (volume.undoStack.length > 8) volume.undoStack.shift();
  document.dispatchEvent(new Event('sculpt-history-change'));
}

export function restoreHistory(volume, redo = false) {
  if (volume.erasing && !redo && volume.surfaceErase?.active) {
    const saved = volume.surfaceErase.saved;
    volume.surfaceErase.abort();
    // Nothing has committed yet: Undo cancels this stroke, not an older edit.
    if (!saved) { document.dispatchEvent(new Event('sculpt-history-change')); return true; }
  }
  if (volume.pulling || volume.cutting || volume.meshQueue?.pending) return false;
  const from = redo ? volume.redoStack : volume.undoStack;
  if (!from?.length) return false;
  const to = redo ? (volume.undoStack ??= []) : (volume.redoStack ??= []);
  const saved = from.pop();
  if(saved.paintOnly) {
    volume.paint ??=new Map();
    const inverse=new Map();
    for(const [key,value]of saved.changes) {
      inverse.set(key,volume.paint.get(key)?.slice());
      if(value)volume.paint.set(key,value.slice());else volume.paint.delete(key);
    }
    to.push({paintOnly:true,changes:inverse});refreshPaint(volume);
    document.dispatchEvent(new Event('sculpt-history-change'));return true;
  }
  if (saved.positionOnly) {
    to.push({ positionOnly: true, userOffset: [...(volume.userOffset ?? [0, 0])] });
    applyMaskPosition(volume, saved.userOffset);
    document.dispatchEvent(new Event('sculpt-history-change')); return true;
  }
  to.push(saved.scaleOnly ? { scaleOnly: true, userScale: volume.userScale ?? 1 } : capture(volume));
  applyMaskScale(volume, saved.userScale ?? 1);
  if (saved.scaleOnly) { document.dispatchEvent(new Event('sculpt-history-change')); return true; }
  applyMaskPosition(volume, saved.userOffset ?? [0, 0]);
  Object.assign(volume, { shape: saved.state.shape, eyeShape: saved.state.eyeShape ?? 'oval', field: new Map(saved.state.field),
    paint:new Map(saved.state.paint ?? []),
    paintCell:saved.state.paintCell,
    extrudeSource:saved.state.extrudeSource, extrusion:saved.state.extrusion,
    pullSource: saved.state.pullSource, pullWarp: saved.state.pullWarp,
    cutSource: saved.state.cutSource, cutRegion: saved.state.cutRegion });
  volume.meshQueue?.invalidate();
  for (const { mesh } of volume.bricks.values()) { volume.parent.remove(mesh); mesh.geometry.dispose(); }
  volume.bricks.clear();
  for (const brick of saved.bricks) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(brick.positions.slice(), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(brick.normals.slice(), 3));
    applyVertexPaint(volume,geometry);
    const mesh = new THREE.Mesh(geometry, volume.material);
    mesh.name = `ClayBrick_${brick.key}`;
    volume.parent.add(mesh); volume.bricks.set(brick.key, { mesh });
  }
  document.dispatchEvent(new Event('sculpt-history-change'));
  return true;
}
