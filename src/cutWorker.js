import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { rasterizeMask, separateCut, cutDistance } from './cutGeometry.js';

self.onmessage = ({ data }) => {
  try {
    const started = performance.now();
    const footprint = rasterizeMask(data.bricks, data.eye, data.planeZ);
    const result = separateCut(footprint, data.points, data.symmetry);
    if (!result.valid) { self.postMessage(result); return; }
    const source = ClayVolume.fromState(data.state);
    const volume = ClayVolume.fromState({ shape: source.shape, field: [] });
    Object.assign(volume, { cutSource: source, cutRegion: result.region, bricks: new Map(), parent: new THREE.Group(), material: null });
    const bricks = [];
    for (let index = 0; index < data.bricks.length; index++) {
      const brick = data.bricks[index], p = brick.positions;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        const d = cutDistance(p[i], p[i + 1], p[i + 2], result.region);
        min = Math.min(min, d); max = Math.max(max, d);
      }
      if (max < -0.04) continue;
      let positions = new Float32Array(), normals = new Float32Array();
      if (min <= 0.04) {
        volume.rebuildBrick(...brick.key.split(',').map(Number));
        const mesh = volume.bricks.get(brick.key)?.mesh;
        if (mesh) {
          positions = mesh.geometry.attributes.position.array; normals = mesh.geometry.attributes.normal.array;
          volume.parent.remove(mesh); mesh.geometry.dispose(); volume.bricks.delete(brick.key);
        }
      }
      bricks.push({ key: brick.key, positions, normals });
      self.postMessage({ progress: (index + 1) / data.bricks.length });
    }
    self.postMessage({ ...result, bricks, duration: performance.now() - started },
      [result.region.distances.buffer, ...bricks.flatMap(b => [b.positions.buffer, b.normals.buffer])]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
