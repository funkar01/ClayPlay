import * as THREE from 'three';
import { diagnostics } from './diagnostics.js';
import { applyVertexPaint } from './paintLayer.js';

let worker;
let nextId = 1;
let busy = false;
let activeId = null;
const volumes = new Map();
let scheduled = false;
let refineWorker=null, refiningJob=null;
function interruptRefinement(id=null) {
  if(!refiningJob || (id!==null && refiningJob.id!==id)) return;
  volumes.get(refiningJob.id)?.fineKeys.add(refiningJob.key);
  refineWorker?.terminate();refineWorker=null;refiningJob=null;
}

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

function refinePump() {
  if(refiningJob || busy)return;
  const entry=[...volumes.values()].find(e=>!e.volume.meshFailed && !e.volume.pulling && !e.volume.cutting && !e.keys.size && e.fineKeys.size);
  if(!entry)return;
  const key=entry.fineKeys.values().next().value;entry.fineKeys.delete(key);
  const job=refiningJob={id:entry.id,key,generation:entry.generation};
  const current=refineWorker ??=new Worker(new URL('./meshWorker.js',import.meta.url),{type:'module'});
  current.onmessage=({data})=>{
    if(refineWorker!==current || refiningJob!==job)return;
    refiningJob=null;
    const target=volumes.get(job.id);
    if(target && target.generation===job.generation && !target.volume.pulling && !target.volume.cutting) {
      if(!data.error)for(const brick of data.bricks)installBrick(target.volume,brick);
      // A fine-detail failure leaves the editable draft intact.
      else console.warn('Surface refinement skipped:',data.error);
    }
    schedule();
  };
  current.onerror=()=>{
    if(refineWorker!==current)return;
    current.terminate();refineWorker=null;refiningJob=null;schedule();
  };
  current.postMessage({id:entry.id,generation:entry.generation,shape:entry.volume.shape,state:entry.volume.serialize(),keys:[key],edits:[],reset:true,step:1});
}
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
  if (!entry) {refinePump();return;}
  interruptRefinement();
  busy = true;
  activeId = entry.id;
  diagnostics.meshPending = entry.keys.size;
  // Bound installation work; do not replace every brick in one UI turn.
  const keys = [...entry.keys].slice(0, 4);
  worker.postMessage({ id: entry.id, generation: entry.generation, shape: entry.volume.shape, state: entry.reset ? entry.volume.serialize() : undefined, keys, edits: [...entry.edits], reset: entry.reset, step:2 });
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
          let bricks=data.bricks;
          for(const brick of bricks)entry.fineKeys.add(brick.key);
          if(entry.volume.surfaceExtrude?.committing) {
            for(const brick of bricks) entry.staged.set(brick.key,brick);
            if(entry.keys.size) {schedule(); return;}
            bricks=[...entry.staged.values()];entry.staged.clear();
            // Swap the entire extrusion in one render turn. Installing partial
            // bricks beneath the live tube causes overlapping bands and cracks.
            entry.volume.surfaceExtrude.clear();
          }
          for (const { key, positions, normals } of bricks) {
          const old = entry.volume.bricks.get(key);
          if (old) { entry.volume.parent.remove(old.mesh); old.mesh.geometry.dispose(); entry.volume.bricks.delete(key); }
          if (!positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
          geometry.computeBoundingSphere();
          applyVertexPaint(entry.volume,geometry);
          const mesh = new THREE.Mesh(geometry, entry.volume.material);
          mesh.name = `ClayBrick_${key}`;
          entry.volume.parent.add(mesh); entry.volume.bricks.set(key, { mesh });
        }
        }
      }
      schedule();
    };
    worker.onerror = (event) => { busy = false; for (const entry of volumes.values()) fail(entry, event.message); };
  }
  const entry = { id: nextId++, generation: 0, volume, keys: new Set(), edits: new Map(), staged:new Map(), fineKeys:new Set(), reset: true };
  volumes.set(entry.id, entry);
  return {
    edit(key, value) { entry.edits.set(key, value); },
    reset() { interruptRefinement(entry.id);entry.generation++; entry.keys.clear(); entry.edits.clear(); entry.staged.clear(); entry.reset = true; },
    brick(key) { entry.keys.add(key); schedule(); },
    get pending() { return entry.keys.size > 0 || (busy && activeId === entry.id); },
    get refining() {return entry.fineKeys.size>0 || refiningJob?.id===entry.id;},
    pauseRefinement() {interruptRefinement(entry.id);},
    refine(keys) {for(const key of keys)entry.fineKeys.add(key);schedule();},
    prioritize(key) {if(!entry.fineKeys.has(key))return;entry.fineKeys=new Set([key,...entry.fineKeys]);},
    invalidate() { interruptRefinement(entry.id);entry.generation++; entry.keys.clear(); entry.edits.clear(); entry.staged.clear(); entry.reset = true; },
    dispose() { interruptRefinement(entry.id);volumes.delete(entry.id); worker.postMessage({ id: entry.id, remove: true });refineWorker?.postMessage({id:entry.id,remove:true}); },
  };
}
