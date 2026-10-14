import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { eraseBrickBounds, eraseNodes } from './eraseGeometry.js';

let volume, bounds, config, previous;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'begin') {
      volume = ClayVolume.fromState(data.state);
      Object.assign(volume, { parent: new THREE.Group(), bricks: new Map(), material: null, meshStep:data.radius<.08 ? 1 : 2 });
      config = data; previous = null;
      bounds = eraseBrickBounds(data.bricks, data.eye, data.planeZ);
      return;
    }
    const started = performance.now(), points = previous ? [previous, ...data.points] : data.points;
    const result = eraseNodes(volume, bounds, points, config.radius, config.eye, config.planeZ, config.symmetry);
    previous = data.points.at(-1) ?? previous;
    const bricks = result.keys.map(key => {
      volume.rebuildBrick(...key.split(',').map(Number));
      const mesh = volume.bricks.get(key)?.mesh;
      const positions = mesh?.geometry.attributes.position.array ?? new Float32Array();
      const normals = mesh?.geometry.attributes.normal.array ?? new Float32Array();
      if (mesh) { volume.parent.remove(mesh); mesh.geometry.dispose(); volume.bricks.delete(key); }
      return { key, positions, normals };
    });
    self.postMessage({ edits: result.edits, bricks, duration: performance.now() - started },
      bricks.flatMap(b => [b.positions.buffer, b.normals.buffer]));
  } catch (error) { self.postMessage({ error: error.message }); }
};
