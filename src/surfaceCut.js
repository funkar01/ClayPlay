import * as THREE from 'three';
import { checkpoint } from './sculptHistory.js';

export class SurfaceCut {
  constructor(volume, onComplete) { this.volume = volume; this.onComplete = onComplete; }
  finish(points, eye, planeZ, symmetry) {
    const volume = this.volume;
    if (volume.cutting || volume.pulling || volume.meshQueue?.pending || points.length < 2) return;
    const source = volume.snapshot();
    this.worker = new Worker(new URL('./cutWorker.js', import.meta.url), { type: 'module' });
    volume.cutting = true;
    const fail = message => { this.abort(); console.error('Mask cut failed:', message); this.onComplete({ error: message }); };
    this.worker.onerror = event => fail(event.message);
    this.worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) { this.onComplete(data); return; }
      clearTimeout(this.timer);
      if (data.error) { fail(data.error); return; }
      if (data.valid) {
        // Checkpoint only a valid cut. An incomplete outline changes neither
        // geometry nor Undo/Redo, and the old mesh stays visible while working.
        checkpoint(volume);
        volume.cutSource = source; volume.cutRegion = data.region;
        volume.pullSource = null; volume.pullWarp = null; volume.field = new Map();
        volume.meshQueue?.invalidate();
        for (const brick of data.bricks) {
          const old = volume.bricks.get(brick.key);
          if (old) { volume.parent.remove(old.mesh); old.mesh.geometry.dispose(); volume.bricks.delete(brick.key); }
          if (!brick.positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(brick.positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(brick.normals, 3));
          geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(geometry, volume.material);
          mesh.name = `ClayBrick_${brick.key}`;
          volume.parent.add(mesh); volume.bricks.set(brick.key, { mesh });
        }
      }
      this.abort(); this.onComplete(data);
      document.dispatchEvent(new Event('sculpt-history-change'));
    };
    const bricks = [...volume.bricks].map(([key, { mesh }]) => ({ key, positions: mesh.geometry.attributes.position.array.slice() }));
    this.worker.postMessage({ points, eye, planeZ, symmetry, state: source.serialize(), bricks }, bricks.map(b => b.positions.buffer));
    this.timer = setTimeout(() => fail('Cut worker timed out'), 30000);
  }
  abort() { clearTimeout(this.timer); this.worker?.terminate(); this.worker = null; this.volume.cutting = false; }
}
