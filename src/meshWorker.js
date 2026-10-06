import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';

const fields = new Map();
self.onmessage = ({ data }) => {
  const { id, generation, shape, edits, keys, reset, remove } = data;
  if (remove) { fields.delete(id); return; }
  try {
    const start = performance.now();
    let volume = fields.get(id);
    if (!volume || reset) {
      volume = data.state ? ClayVolume.fromState(data.state) : Object.create(ClayVolume.prototype);
      Object.assign(volume, { shape, bricks: new Map(), parent: new THREE.Group(), material: null });
      volume.field ??= new Map();
      fields.set(id, volume);
    }
    for (const [key, value] of edits) volume.field.set(key, value);
    const bricks = [];
    const transfer = [];
    for (const key of keys) {
      volume.rebuildBrick(...key.split(',').map(Number));
      const mesh = volume.bricks.get(key)?.mesh;
      const positions = mesh?.geometry.attributes.position.array ?? new Float32Array();
      const normals = mesh?.geometry.attributes.normal.array ?? new Float32Array();
      bricks.push({ key, positions, normals });
      transfer.push(positions.buffer, normals.buffer);
      if (mesh) { volume.parent.remove(mesh); mesh.geometry.dispose(); volume.bricks.delete(key); }
    }
    self.postMessage({ id, generation, bricks, duration: performance.now() - start }, transfer);
  } catch (error) { self.postMessage({ id, generation, error: error.message }); }
};
