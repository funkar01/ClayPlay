import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { cacheVolumeNodes } from './cacheVolumeNodes.js';
import { eraseBrickBounds, eraseNodes } from './eraseGeometry.js';
import { spanningSurfaceRegions, expandSurfaceRebuildKeys } from './surfaceBricks.js';

let volume, bounds, config, previous, regions;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'begin') {
      volume = cacheVolumeNodes(ClayVolume.fromState(data.state));
      Object.assign(volume, { parent: new THREE.Group(), bricks: new Map(), material: null, meshStep:1 });
      config = data; previous = null;
      bounds = eraseBrickBounds(data.bricks, data.eye, data.planeZ);
      regions = spanningSurfaceRegions(data.bricks);
      return;
    }
    if (data.breakBefore) previous = null;
    const started = performance.now(), points = previous ? [previous, ...data.points] : data.points;
    const result = eraseNodes(volume, bounds, points, config.radius, config.eye, config.planeZ, config.symmetry);
    previous = data.points.at(-1) ?? previous;
    const keys = expandSurfaceRebuildKeys(result.keys,regions);
    const bricks = [...keys].map(key => {
      volume.rebuildBrick(...key.split(',').map(Number));
      const mesh = volume.bricks.get(key)?.mesh;
      const positions = mesh?.geometry.attributes.position.array ?? new Float32Array();
      const normals = mesh?.geometry.attributes.normal.array ?? new Float32Array();
      if (mesh) { volume.parent.remove(mesh); mesh.geometry.dispose(); volume.bricks.delete(key); }
      return { key, positions, normals };
    });
    regions = regions.filter(region=>!keys.has(region.key));
    self.postMessage({ edits: result.edits, bricks, duration: performance.now() - started },
      bricks.flatMap(b => [b.positions.buffer, b.normals.buffer]));
  } catch (error) { self.postMessage({ error: error.message }); }
};
