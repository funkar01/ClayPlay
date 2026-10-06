import * as THREE from 'three';
import { diagnostics } from './diagnostics.js';

let worker;
let nextId = 1;
let busy = false;
let activeId = null;
const volumes = new Map();
let scheduled = false;
function fail(entry, message) {
  entry.volume.meshFailed = true;
  entry.keys.clear(); entry.edits.clear();
  diagnostics.pause = 'mesh update failed';
  console.error('Clay mesh update failed:', message);
  document.dispatchEvent(new Event('clay-mesh-error'));
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; pump(); }, 0);
}
function pump() {
  if (busy) return;
  const entry = [...volumes.values()].find((v) => !v.volume.meshFailed && !v.volume.pulling && !v.volume.cutting && v.keys.size);
  if (!entry) return;
  busy = true;
  activeId = entry.id;
  diagnostics.meshPending = entry.keys.size;
  // Bound installation work; do not replace every brick in one UI turn.
  const keys = [...entry.keys].slice(0, 4);
  worker.postMessage({ id: entry.id, generation: entry.generation, shape: entry.volume.shape, state: entry.reset ? entry.volume.serialize() : undefined, keys, edits: [...entry.edits], reset: entry.reset });
  keys.forEach(key => entry.keys.delete(key)); entry.edits.clear(); entry.reset = false;
}
export function attachMeshQueue(volume) {
  if (!worker) {
    worker = new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      busy = false;
      activeId = null;
      diagnostics.meshMs = data.duration ?? 0;
      diagnostics.meshPending = 0;
      const entry = volumes.get(data.id);
      if (entry && entry.generation === data.generation) {
        if (data.error) fail(entry, data.error);
        else for (const { key, positions, normals } of data.bricks) {
          const old = entry.volume.bricks.get(key);
          if (old) { entry.volume.parent.remove(old.mesh); old.mesh.geometry.dispose(); entry.volume.bricks.delete(key); }
          if (!positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
          geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(geometry, entry.volume.material);
          mesh.name = `ClayBrick_${key}`;
          entry.volume.parent.add(mesh); entry.volume.bricks.set(key, { mesh });
        }
      }
      schedule();
    };
    worker.onerror = (event) => { busy = false; for (const entry of volumes.values()) fail(entry, event.message); };
  }
  const entry = { id: nextId++, generation: 0, volume, keys: new Set(), edits: new Map(), reset: true };
  volumes.set(entry.id, entry);
  return {
    edit(key, value) { entry.edits.set(key, value); },
    reset() { entry.generation++; entry.keys.clear(); entry.edits.clear(); entry.reset = true; },
    brick(key) { entry.keys.add(key); schedule(); },
    get pending() { return entry.keys.size > 0 || (busy && activeId === entry.id); },
    invalidate() { entry.generation++; entry.keys.clear(); entry.edits.clear(); entry.reset = true; },
    dispose() { volumes.delete(entry.id); worker.postMessage({ id: entry.id, remove: true }); },
  };
}
