import * as THREE from 'three';
import { makeWarp, forwardWarp } from './maskWarp.js';
import { diagnostics } from './diagnostics.js';
import { PullPreview } from './pullPreview.js';
import { anchorVertex } from './pullGeometry.js';
import { applyVertexPaint,refreshPaint } from './paintLayer.js';

export class SurfacePull {
  constructor(volume, onChange) { this.volume = volume; this.onChange = onChange; }
  get appliedWarp() {
    if (!this.active || !this.preview?.uniforms.pullEnabled.value) return this.committedWarp;
    return makeWarp(this.anchor.toArray(), this.preview.uniforms.pullDelta.value.toArray(), this.radius, this.softness, this.symmetry);
  }
  begin(anchor, radius, softness, symmetry = false) {
    if (radius <= 0 || this.volume.pulling || this.volume.cutting || this.volume.meshQueue?.pending || !this.volume.bricks.size) return false;
    this.volume.meshQueue?.pauseRefinement?.();
    this.source = this.volume.snapshot();
    this.anchor = anchor.clone(); this.radius = radius; this.softness = softness; this.symmetry = symmetry;
    this.lastWarp = makeWarp(anchor.toArray(), [0, 0, 0], radius, softness, symmetry);
    this.committedWarp = this.lastWarp;
    this.preview = this.volume.pullPreview ??= new PullPreview(this.volume.material);
    const worker = this.worker = new Worker(new URL('./pullWorker.js', import.meta.url), { type: 'module' });
    this.volume.pulling = true; this.active = true; this.busy = false; this.released = false;
    this.worker.onmessage = ({ data }) => {
      if (this.worker !== worker || !this.active) return;
      clearTimeout(this.timer);
      if (data.error) { this.fail(data.error); return; }
      this.busy = false;
      diagnostics.pullWorkerMs = data.duration;
      // The GPU owns the live surface; worker previews must never roll it back.
      if (!data.final) return;
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
      this.committedWarp = data.warp;
      if (data.final) {
        this.preview.clear();
        if (Math.hypot(...data.warp.delta) > 0.0005) {
          this.volume.pullSource = this.source;
          this.volume.extrudeSource=null; this.volume.extrusion=null;
          this.volume.pullWarp = data.warp;
          this.volume.field = new Map();
          this.volume.paint=new Map();
          this.volume.cutSource = null; this.volume.cutRegion = null;
          this.volume.meshQueue?.invalidate();
          this.onChange();
        } else {
          // A pinch without a shape change is not an undoable action.
          this.volume.undoStack?.pop();
        }
        this.volume.pulling = false; this.active = false;
        refreshPaint(this.volume);
        this.volume.meshQueue?.refine?.([...this.volume.bricks.keys()]);
        this.worker.terminate(); this.worker = null;
        document.dispatchEvent(new Event('sculpt-history-change'));
      }
    };
    this.worker.onerror = event => { if (this.worker === worker) this.fail(event.message); };
    const bricks = [...this.volume.bricks].map(([key, { mesh }]) => ({ key,
      positions: mesh.geometry.attributes.position.array.slice(), normals: mesh.geometry.attributes.normal.array.slice() }));
    const original = bricks.map(b => ({ ...b }));
    anchorVertex(bricks, anchor.toArray());
    if (symmetry && Math.abs(anchor.x) > 1e-6) anchorVertex(bricks, [-anchor.x, anchor.y, anchor.z], .005);
    for (let i = 0; i < bricks.length; i++) {
      if (bricks[i].positions === original[i].positions) continue;
      const geometry = this.volume.bricks.get(bricks[i].key).mesh.geometry;
      geometry.setAttribute('position', new THREE.BufferAttribute(bricks[i].positions.slice(), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(bricks[i].normals.slice(), 3));
      applyVertexPaint(this.volume,geometry);
      geometry.boundingBox = null; geometry.boundingSphere = null;
    }
    for (const { mesh } of this.volume.bricks.values()) mesh.frustumCulled = false;
    this.preview.begin(this.lastWarp);
    // Send the original topology so a no-op release restores it exactly.
    this.worker.postMessage({ type: 'begin', bricks: original, anchor: anchor.toArray(), symmetry }, original.flatMap(b => [b.positions.buffer, b.normals.buffer]));
    return true;
  }
  update(delta) {
    if (!this.active || this.released) return null;
    this.lastWarp = makeWarp(this.anchor.toArray(), delta.toArray(), this.radius, this.softness, this.symmetry);
    this.preview.update(this.lastWarp);
    return new THREE.Vector3(...forwardWarp(...this.anchor.toArray(), this.lastWarp));
  }
  finish() {
    if (!this.active || this.released) return;
    this.released = true;
    this.preview.freeze(this.lastWarp);
    // Worker/render latency must not discard a quick drag. update() rejects
    // subsequent open-hand positions, so this target is frozen at release.
    this.busy = true;
    const worker=this.worker;
    this.timer = setTimeout(() => {
      if(this.worker === worker && this.active && this.busy) document.dispatchEvent(new Event('sculpt-save-pending'));
    }, 5000);
    this.worker.postMessage({ type: 'preview', warp: this.lastWarp, final: true });
  }
  abort() {
    clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = null;
    this.preview?.clear();
    this.active = false; this.busy = false; this.volume.pulling = false;
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
