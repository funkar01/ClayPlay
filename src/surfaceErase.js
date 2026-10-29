import { emitStudioCommit } from './studioFeedback.js';
import * as THREE from 'three';
import { checkpoint } from './sculptHistory.js';
import { diagnostics } from './diagnostics.js';
import { ErasePreview } from './erasePreview.js';
import { eraseBrickBounds } from './eraseGeometry.js';
import { applyVertexPaint } from './paintLayer.js';

export class SurfaceErase {
  constructor(volume, onChange) { this.volume = volume; this.onChange = onChange; }
  get saved() { return this.savedStroke === this.strokeId; }
  begin(radius, eye, planeZ, symmetry) {
    const v = this.volume;
    // Continue accepting distinct strokes while earlier batches catch up.
    // Keep their boundaries so neither geometry nor Undo joins the gap.
    if (this.active) {
      if (!this.released || radius !== this.radius || planeZ !== this.planeZ || symmetry !== this.symmetry ||
        eye.some((n, i) => Math.abs(n - this.eye[i]) > .0001)) return false;
      clearTimeout(this.releaseDeadline);
      this.strokeId++;
      this.commitSounds();
      this.released = false;
      this.lastPoint = null;
      if (v.erasePreview) v.erasePreview.last = null;
      return true;
    }
    if (radius <= 0 || v.pulling || v.cutting || v.meshQueue?.pending || !v.bricks.size) return false;
    v.meshQueue?.pauseRefinement?.();
    this.radius = radius; this.pending = []; this.lastPoint = null; this.anySaved = false;
    this.eye = [...eye]; this.planeZ = planeZ; this.symmetry = symmetry;
    this.strokeId = 0; this.savedStroke = -1; this.sentStroke = -1;
    this.soundStrokes = new Map();
    this.active = true; this.busy = false; this.released = false;
    this.changedKeys=new Set();
    v.erasing = true; v.cutting = true;
    const worker = this.worker = new Worker(new URL('./eraseWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if(this.worker !== worker || !this.active) return;
      clearTimeout(this.timer); clearTimeout(this.watchdog); this.busy = false;
      if (data.error) { this.fail(data.error); return; }
      diagnostics.eraseWorkerMs = data.duration;
      if (data.edits.length) {
        if (this.savedStroke !== this.inFlightStroke) {
          checkpoint(v); this.anySaved = true; this.savedStroke = this.inFlightStroke;
          v.meshQueue?.invalidate();
        }
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
        this.soundStrokes.set(this.inFlightStroke, (this.soundStrokes.get(this.inFlightStroke) ?? 0) + data.edits.length);
      }
      this.commitSounds();
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
    this.lastPoint = [...point]; this.pending.push({ point: this.lastPoint, stroke: this.strokeId });
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
    this.watchdog = setTimeout(() => {
      if(this.worker === worker && this.active && this.busy) this.fail('Erase timed out; completed parts were kept.');
    }, 15000);
    this.inFlightStroke = this.pending[0].stroke;
    let count = 0;
    while (count < 32 && this.pending[count]?.stroke === this.inFlightStroke) count++;
    const points = this.pending.splice(0, count).map(sample => sample.point);
    const breakBefore = this.sentStroke !== this.inFlightStroke;
    this.sentStroke = this.inFlightStroke;
    this.worker.postMessage({ type: 'erase', points, breakBefore });
  }
  finish() {
    if (!this.active || this.released) return;
    // Freeze sampling immediately. Only positions captured while held finish;
    // an opening index finger can never extend the stroke.
    this.released = true; this.commitSounds(); this.pump();
    if(this.active) this.releaseDeadline = setTimeout(() => {
      if(this.active && this.released) this.fail('Erase queue timed out; completed parts were kept.');
    }, 15000);
  }
  commitSounds() {
    for(const [stroke, edits] of this.soundStrokes ?? []) {
      if(stroke === this.strokeId && !this.released)continue;
      if((this.busy && stroke === this.inFlightStroke) || this.pending.some(sample=>sample.stroke===stroke))continue;
      emitStudioCommit('erase',{intensity:Math.min(1,edits/1000)});
      this.soundStrokes.delete(stroke);
    }
  }
  complete() {
    const changed = this.anySaved;
    this.volume.meshQueue?.refine?.([...this.changedKeys]);
    this.abort(); this.onChange({ done: true, changed }); document.dispatchEvent(new Event('sculpt-history-change'));
  }
  abort() {
    clearTimeout(this.timer); clearTimeout(this.watchdog); clearTimeout(this.releaseDeadline); this.worker?.terminate(); this.worker = null;
    this.volume.erasePreview?.clear();
    this.active = false; this.pending = []; this.volume.erasing = false; this.volume.cutting = false;
    this.volume.meshQueue?.resumeRefinement?.();
  }
  fail(message) { console.error('Mask erase failed:', message); this.abort(); this.onChange({ error: message }); document.dispatchEvent(new Event('sculpt-history-change')); }
}
