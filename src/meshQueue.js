import * as THREE from 'three';
import { diagnostics } from './diagnostics.js';
import { applyVertexPaint } from './paintLayer.js';
import { SurfaceCleanup } from './surfaceCleanup.js';

let worker;
let nextId = 1;
let busy = false;
let activeId = null;
const volumes = new Map();
let scheduled = false;
function installBrick(volume,{key,positions,normals}) {
  const old=volume.bricks.get(key);
  if(old){volume.parent.remove(old.mesh);old.mesh.geometry.dispose();volume.bricks.delete(key);}
  if(!positions.length)return;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.computeBoundingSphere();
  applyVertexPaint(volume,geometry);
  const mesh=new THREE.Mesh(geometry,volume.material);mesh.name=`ClayBrick_${key}`;
  volume.parent.add(mesh);volume.bricks.set(key,{mesh});
}

function fail(entry, message) {
  entry.volume.meshFailed = true;
  entry.keys.clear(); entry.edits.clear(); entry.staged.clear();
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
  const entry = [...volumes.values()].find((v) => !v.volume.meshFailed
    && (!v.volume.pulling || (v.volume.surfaceExtrude?.active && v.volume.surfaceExtrude.committing))
    && !v.volume.cutting && v.keys.size);
  if (!entry) return;
  busy = true;
  activeId = entry.id;
  diagnostics.meshPending = entry.keys.size;
  // Bound worker jobs; publish their results together after the last batch.
  const keys = [...entry.keys].slice(0, 4);
  worker.postMessage({ id: entry.id, generation: entry.generation, shape: entry.volume.shape, state: entry.reset ? entry.volume.serialize() : undefined, keys, edits: [...entry.edits], reset: entry.reset, step:1 });
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
        else {
          // Keep the old continuous surface until the entire revision is ready.
          for(const brick of data.bricks) entry.staged.set(brick.key,brick);
          if(entry.keys.size) {schedule(); return;}
          const bricks=[...entry.staged.values()];entry.staged.clear();
          for(const brick of bricks) installBrick(entry.volume,brick);
          if(entry.volume.surfaceExtrude?.committing) {
            const tool=entry.volume.surfaceExtrude;
            if(tool.onMeshReady)tool.onMeshReady();else tool.clear();
          }
        }
      }
      schedule();
    };
    worker.onerror = (event) => { busy = false; for (const entry of volumes.values()) fail(entry, event.message); };
  }
  const entry = { id: nextId++, generation: 0, volume, keys: new Set(), edits: new Map(), staged:new Map(), reset: true };
  volumes.set(entry.id, entry);
  const cleanup=new SurfaceCleanup(volume,brick=>installBrick(volume,brick),()=>Boolean(
    volume.meshFailed || volume.pulling || volume.cutting || volume.surfacePaint?.active
    || entry.keys.size || (busy && activeId===entry.id)));
  return {
    edit(key, value) { cleanup.cancel(); entry.edits.set(key, value); },
    reset() { cleanup.cancel(); entry.generation++; entry.keys.clear(); entry.edits.clear(); entry.staged.clear(); entry.reset = true; },
    brick(key) { cleanup.cancel(); entry.keys.add(key); schedule(); },
    get pending() { return entry.keys.size > 0 || (busy && activeId === entry.id); },
    get refining() {return cleanup.pending;},
    pauseRefinement() {cleanup.pause();},
    resumeRefinement() {cleanup.resume();},
    // All authoritative meshes already use the full grid resolution.
    refine() {},
    remeshSurface() {cleanup.request();},
    prioritize() {},
    flush() {schedule();},
    invalidate() { cleanup.cancel(); entry.generation++; entry.keys.clear(); entry.edits.clear(); entry.staged.clear(); entry.reset = true; },
    dispose() { cleanup.dispose(); volumes.delete(entry.id); worker.postMessage({ id: entry.id, remove: true }); },
  };
}
