import * as THREE from 'three';
import { makeWarp } from './maskWarp.js';
import { diagnostics } from './diagnostics.js';

export class SurfacePull {
  constructor(volume, onChange) { this.volume = volume; this.onChange = onChange; }
  begin(anchor, radius, softness) {
    if (radius <= 0 || this.volume.pulling || this.volume.meshQueue?.pending || !this.volume.bricks.size) return false;
    this.source = this.volume.snapshot();
    this.anchor = anchor.clone(); this.radius = radius; this.softness = softness;
    this.lastWarp = makeWarp(anchor.toArray(), [0, 0, 0], radius, softness);
    this.worker = new Worker(new URL('./pullWorker.js', import.meta.url), { type: 'module' });
    this.volume.pulling = true; this.active = true; this.busy = false; this.released = false;
    this.worker.onmessage = ({ data }) => {
      clearTimeout(this.timer);
      if (data.error) { this.fail(data.error); return; }
      this.busy = false;
      diagnostics.pullWorkerMs = data.duration;
      const started = performance.now();
      if (data.repartition) {
        for (const { mesh } of this.volume.bricks.values()) { this.volume.parent.remove(mesh); mesh.geometry.dispose(); }
        this.volume.bricks.clear();
      }
      for (const brick of data.bricks) {
        let mesh = this.volume.bricks.get(brick.key)?.mesh;
        if (!mesh && data.repartition) {
          mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.volume.material);
          mesh.name = `ClayBrick_${brick.key}`;
          this.volume.parent.add(mesh); this.volume.bricks.set(brick.key, { mesh });
        }
        if (!mesh) continue;
        const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal');
        if (positions?.array.length === brick.positions.length && normals?.array.length === brick.normals.length) {
          positions.array.set(brick.positions); normals.array.set(brick.normals);
          positions.needsUpdate = true; normals.needsUpdate = true;
        } else {
          mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry();
          mesh.geometry.setAttribute('position', new THREE.BufferAttribute(brick.positions, 3).setUsage(THREE.DynamicDrawUsage));
          mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(brick.normals, 3).setUsage(THREE.DynamicDrawUsage));
        }
        mesh.geometry.boundingBox = null; mesh.geometry.boundingSphere = null;
        mesh.frustumCulled = false;
      }
      diagnostics.pullInstallMs = performance.now() - started;
      if (data.final) {
        if (Math.hypot(...data.warp.delta) > 0.0005) {
          this.volume.pullSource = this.source;
          this.volume.pullWarp = data.warp;
          this.volume.field = new Map(); this.volume.cuts = [];
          this.volume.meshQueue?.invalidate();
          this.onChange();
        } else {
          // A pinch without a shape change is not an undoable action.
          this.volume.undoStack?.pop();
        }
        this.volume.pulling = false; this.active = false;
        this.worker.terminate(); this.worker = null;
        document.dispatchEvent(new Event('sculpt-history-change'));
      } else this.pump();
    };
    this.worker.onerror = event => this.fail(event.message);
    const bricks = [...this.volume.bricks].map(([key, { mesh }]) => ({ key,
      positions: mesh.geometry.attributes.position.array.slice(), normals: mesh.geometry.attributes.normal.array.slice() }));
    this.worker.postMessage({ type: 'begin', bricks, anchor: anchor.toArray() }, bricks.flatMap(b => [b.positions.buffer, b.normals.buffer]));
    return true;
  }
  update(delta) {
    if (!this.active || this.released) return null;
    this.lastWarp = makeWarp(this.anchor.toArray(), delta.toArray(), this.radius, this.softness);
    this.pending = this.lastWarp; this.pump();
    return this.anchor.clone().add(new THREE.Vector3(...this.lastWarp.delta));
  }
  pump() {
    if (this.busy || !this.pending || !this.worker) return;
    const warp = this.pending; this.pending = null; this.busy = true;
    this.timer = setTimeout(() => this.fail('Pull worker timed out'), 5000);
    this.worker.postMessage({ type: 'preview', warp, final: this.released });
  }
  finish() {
    if (!this.active || this.released) return;
    this.released = true; this.pending = this.lastWarp; this.pump();
  }
  abort() {
    clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = null;
    this.active = false; this.volume.pulling = false; this.pending = null;
  }
  fail(message) {
    console.error('Mask pull failed:', message);
    // Restore the original mesh after a worker failure rather than leaving a
    // preview whose geometry disagrees with the authoritative field.
    this.abort();
    this.volume.meshQueue?.invalidate();
    for (const key of this.volume.bricks.keys()) this.volume.rebuildBrick(...key.split(',').map(Number));
    document.dispatchEvent(new Event('mask-pull-error'));
  }
}
