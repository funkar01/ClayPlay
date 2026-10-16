import * as THREE from 'three';
import { checkpoint } from './sculptHistory.js';
import { diagnostics } from './diagnostics.js';
import { ErasePreview } from './erasePreview.js';
import { eraseBrickBounds } from './eraseGeometry.js';
import { applyVertexPaint } from './paintLayer.js';

export class SurfaceErase {
  constructor(volume, onChange) { this.volume = volume; this.onChange = onChange; }
  begin(radius, eye, planeZ, symmetry) {
    const v = this.volume;
    if (radius <= 0 || v.pulling || v.cutting || v.meshQueue?.pending || !v.bricks.size) return false;
    v.meshQueue?.pauseRefinement?.();
    this.radius = radius; this.pending = []; this.lastPoint = null; this.saved = false;
    this.active = true; this.busy = false; this.released = false;
    this.changedKeys=new Set();
    v.erasing = true; v.cutting = true;
    const worker = this.worker = new Worker(new URL('./eraseWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if(this.worker !== worker || !this.active) return;
      clearTimeout(this.timer); this.busy = false;
      if (data.error) { this.fail(data.error); return; }
      diagnostics.eraseWorkerMs = data.duration;
      if (data.edits.length) {
        if (!this.saved) { checkpoint(v); this.saved = true; v.meshQueue?.invalidate(); }
        for (const [key, value] of data.edits) v.field.set(key, value);
        for (const brick of data.bricks) {
          this.changedKeys.add(brick.key);
          const old = v.bricks.get(brick.key);
          if (old) { v.parent.remove(old.mesh); old.mesh.geometry.dispose(); v.bricks.delete(brick.key); }
          if (!brick.positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(brick.positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(brick.normals, 3)); geometry.computeBoundingSphere();
          applyVertexPaint(v,geometry);
          const mesh = new THREE.Mesh(geometry, v.material); mesh.name = `ClayBrick_${brick.key}`;
          v.parent.add(mesh); v.bricks.set(brick.key, { mesh });
        }
        this.onChange({ changed: true });
      }
      this.pump();
    };
    this.worker.onerror = event => {if(this.worker === worker && this.active) this.fail(event.message);};
    const bricks = [...v.bricks].map(([key, { mesh }]) => ({ key, positions: mesh.geometry.attributes.position.array.slice() }));
    if (v.material && typeof document.createElement === 'function') {
      v.erasePreview ??= new ErasePreview(v.material);
      v.erasePreview.begin(radius,eye,planeZ,symmetry,eraseBrickBounds(bricks,eye,planeZ));
    }
    this.worker.postMessage({ type: 'begin', radius, eye, planeZ, symmetry, state: v.serialize(), bricks }, bricks.map(b => b.positions.buffer));
    return true;
  }
  update(point) {
    if (!this.active || this.released) return;
    if(!point.every(Number.isFinite)) return;
    if (this.lastPoint && Math.hypot(point[0] - this.lastPoint[0], point[1] - this.lastPoint[1]) < .002) return;
    // Preview exactly the path accepted for saving. Never hide points that the
    // geometry worker will later skip or simplify away.
    this.volume.erasePreview?.update(point);
    this.lastPoint = [...point]; this.pending.push(this.lastPoint);
    // Work remains batched, but queued curves are never silently discarded.
    this.pump();
  }
  pump() {
    if (this.busy || !this.worker) return;
    if (!this.pending.length) { if (this.released) this.complete(); return; }
    this.busy = true;
    const worker=this.worker;
    this.timer = setTimeout(() => {
      if(this.worker === worker && this.active && this.busy) this.onChange({pending:true});
    }, 10000);
    this.worker.postMessage({ type: 'erase', points: this.pending.splice(0, 32) });
  }
  finish() {
    if (!this.active || this.released) return;
    // Freeze sampling immediately. Only positions captured while held finish;
    // an opening index finger can never extend the stroke.
    this.released = true; this.pump();
  }
  complete() {
    const changed = this.saved;
    this.volume.meshQueue?.refine?.([...this.changedKeys]);
    this.abort(); this.onChange({ done: true, changed }); document.dispatchEvent(new Event('sculpt-history-change'));
  }
  abort() {
    clearTimeout(this.timer); this.worker?.terminate(); this.worker = null;
    this.volume.erasePreview?.clear();
    this.active = false; this.pending = []; this.volume.erasing = false; this.volume.cutting = false;
  }
  fail(message) { console.error('Mask erase failed:', message); this.abort(); this.onChange({ error: message }); document.dispatchEvent(new Event('sculpt-history-change')); }
}
