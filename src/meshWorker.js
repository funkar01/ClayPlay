import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { cacheVolumeNodes } from './cacheVolumeNodes.js';

const fields = new Map();
self.onmessage = ({ data }) => {
  const { id, generation, shape, edits, keys, reset, remove } = data;
  if (remove) { fields.delete(id); return; }
  try {
    const start = performance.now();
    let volume = fields.get(id);
    if(data.appendExtrusion && volume) {
      const source=volume;
      volume=ClayVolume.fromState({shape:source.shape,eyeShape:source.eyeShape,field:[]});
      Object.assign(volume,{extrudeSource:source,extrusion:data.appendExtrusion,bricks:new Map(),parent:new THREE.Group(),material:null});
      cacheVolumeNodes(volume);fields.set(id,volume);
    } else if (!volume || reset) {
      if(data.appendExtrusion && !data.state)throw new Error('Extrusion source revision is unavailable');
      volume = data.state ? ClayVolume.fromState(data.state) : Object.create(ClayVolume.prototype);
      Object.assign(volume, { shape, bricks: new Map(), parent: new THREE.Group(), material: null });
      volume.field ??= new Map();
      cacheVolumeNodes(volume);
      fields.set(id, volume);
    }
    for (const [key, value] of edits) volume.field.set(key, value);
    volume.meshStep=data.step ?? 1;
    const bricks = [];
    const transfer = [];
    for (const key of keys) {
      volume.rebuildBrick(...key.split(',').map(Number));
      const mesh = volume.bricks.get(key)?.mesh;
      const positions = mesh?.geometry.attributes.position.array ?? new Float32Array();
      const normals = mesh?.geometry.attributes.normal.array ?? new Float32Array();
      const tints = mesh?.geometry.getAttribute('extrudeColor')?.array;
      const box=mesh?.geometry.boundingBox;
      bricks.push({ key, positions, normals, tints,bounds:box?{min:box.min.toArray(),max:box.max.toArray()}:undefined });
      transfer.push(positions.buffer, normals.buffer);
      if(tints)transfer.push(tints.buffer);
      if (mesh) { volume.parent.remove(mesh); mesh.geometry.dispose(); volume.bricks.delete(key); }
    }
    self.postMessage({ id, generation, bricks, duration: performance.now() - start }, transfer);
  } catch (error) { self.postMessage({ id, generation, error: error.message }); }
};
