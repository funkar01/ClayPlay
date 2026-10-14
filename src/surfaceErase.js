import * as THREE from 'three';
import { checkpoint } from './sculptHistory.js';
import { diagnostics } from './diagnostics.js';
import { ErasePreview } from './erasePreview.js';
import { eraseBrickBounds } from './eraseGeometry.js';

export class SurfaceErase {
  constructor(volume, onChange) { this.volume = volume; this.onChange = onChange; }
  begin(radius, eye, planeZ, symmetry) {
    const v = this.volume;
    if (radius <= 0 || v.pulling || v.cutting || v.meshQueue?.pending || !v.bricks.size) return false;
    this.radius = radius; this.pending = []; this.lastPoint = null; this.saved = false;
    this.active = true; this.busy = false; this.released = false;
    v.erasing = true; v.cutting = true;
    this.worker = new Worker(new URL('./eraseWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      clearTimeout(this.timer); this.busy = false;
      if (data.error) { this.fail(data.error); return; }
      diagnostics.eraseWorkerMs = data.duration;
      if (data.edits.length) {
        if (!this.saved) { checkpoint(v); this.saved = true; v.meshQueue?.invalidate(); }
        for (const [key, value] of data.edits) v.field.set(key, value);
        for (const brick of data.bricks) {
          const old = v.bricks.get(brick.key);
          if (old) { v.parent.remove(old.mesh); old.mesh.geometry.dispose(); v.bricks.delete(brick.key); }
          if (!brick.positions.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(brick.positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(brick.normals, 3)); geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(geometry, v.material); mesh.name = `ClayBrick_${brick.key}`;
          v.parent.add(mesh); v.bricks.set(brick.key, { mesh });
        }
        this.onChange({ changed: true });
      }
      this.pump();
    };
    this.worker.onerror = event => this.fail(event.message);
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
    this.volume.erasePreview?.update(point);
    if (this.lastPoint && Math.hypot(point[0] - this.lastPoint[0], point[1] - this.lastPoint[1]) < Math.max(.008, this.radius * .12)) return;
    this.lastPoint = [...point]; this.pending.push(this.lastPoint);
    // Bound the queue while retaining the sweep between consecutive samples.
    // Remove the least significant bend instead of every second point, which
    // would cut across tight curves. Always retain the first and latest points.
    if (this.pending.length > 32) {
      let smallest = Infinity, remove = 1;
      for (let i=1;i<this.pending.length-1;i++) {
        const a=this.pending[i-1], b=this.pending[i], c=this.pending[i+1];
        const dx=c[0]-a[0], dy=c[1]-a[1];
        const t=Math.max(0,Math.min(1,((b[0]-a[0])*dx+(b[1]-a[1])*dy)/(dx*dx+dy*dy || 1)));
        const error=Math.hypot(b[0]-a[0]-t*dx,b[1]-a[1]-t*dy);
        if (error<smallest) { smallest=error; remove=i; }
      }
      this.pending.splice(remove,1);
    }
    this.pump();
  }
  pump() {
    if (this.busy || !this.worker) return;
    if (!this.pending.length) { if (this.released) this.complete(); return; }
    this.busy = true;
    this.timer = setTimeout(() => this.fail('Erase worker timed out'), 10000);
    this.worker.postMessage({ type: 'erase', points: this.pending.splice(0, 32) });
  }
  finish() {
    if (!this.active || this.released) return;
    // Freeze sampling immediately. Only positions captured while held finish;
    // an opening index finger can never extend the stroke.
    this.released = true; this.pump();
  }
  complete() { const changed = this.saved; this.abort(); this.onChange({ done: true, changed }); document.dispatchEvent(new Event('sculpt-history-change')); }
  abort() {
    clearTimeout(this.timer); this.worker?.terminate(); this.worker = null;
    this.volume.erasePreview?.clear();
    this.active = false; this.pending = []; this.volume.erasing = false; this.volume.cutting = false;
  }
  fail(message) { console.error('Mask erase failed:', message); this.abort(); this.onChange({ error: message }); document.dispatchEvent(new Event('sculpt-history-change')); }
}
