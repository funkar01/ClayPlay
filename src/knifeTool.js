import * as THREE from 'three';

export class KnifeTool {
  constructor(scene, onCut, onMessage, onBeforeCut = () => {}) {
    this.onCut = onCut;
    this.onMessage = onMessage;
    this.onBeforeCut = onBeforeCut;
    this.blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 9, 0.12), new THREE.MeshStandardMaterial({ color: '#8bc8da', metalness: 0.55, roughness: 0.25, transparent: true, opacity: 0.65 }));
    scene.add(this.blade);
    this.reset();
  }
  reset() {
    this.blade.visible = false;
    this.openAt = null;
    this.stroke = null;
    this.locked = false;
  }
  update(points, group, volume, mouseHeld = null) {
    const now = performance.now();
    const p = points.map((v) => new THREE.Vector3(v.x, v.y, v.z));
    const straight = [[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]].every(([a,b,c,d]) => {
      const length = p[a].distanceTo(p[b]) + p[b].distanceTo(p[c]) + p[c].distanceTo(p[d]);
      return p[a].distanceTo(p[d]) > length * 0.87;
    });
    const open = mouseHeld === null ? straight && p[4].distanceTo(p[8]) > p[5].distanceTo(p[17]) * 0.5 : mouseHeld;
    if (!open) { this.reset(); return; }
    this.openAt ??= now;
    if (now - this.openAt < (mouseHeld === null ? 120 : 0) || this.locked || volume.cutting) return;
    const center = mouseHeld === null ? p[0].clone().add(p[5]).add(p[9]).add(p[13]).add(p[17]).multiplyScalar(0.2) : p[8].clone();
    let axis = mouseHeld === null ? p[9].clone().sub(p[0]).normalize() : new THREE.Vector3(0,1,0);
    let normal = mouseHeld === null ? p[5].clone().sub(p[17]).cross(axis).normalize() : new THREE.Vector3(0,0,1);
    if (normal.lengthSq() < 0.5) return;
    group.updateMatrixWorld(true);
    const local = group.worldToLocal(center.clone());
    if (this.stroke) {
      if (Math.abs(normal.dot(this.stroke.normal)) < 0.85 || Math.abs(local.clone().sub(this.stroke.origin).dot(this.stroke.normal)) > 0.3) {
        this.reset(); this.onMessage('Cut cancelled · keep the blade in one plane'); return;
      }
      axis = this.stroke.axis;
      normal = this.stroke.normal;
      local.addScaledVector(normal, -local.clone().sub(this.stroke.origin).dot(normal));
    }
    this.blade.visible = true;
    this.blade.position.copy(group.localToWorld(local.clone()));
    this.blade.scale.setScalar(group.scale.x);
    this.blade.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis.clone().cross(normal).normalize(), axis, normal));
    // The nine-unit blade exceeds the full editable volume's diagonal.
    let touching = false;
    for (let t = -4.5; t <= 4.5; t += 0.035) {
      const point = local.clone().addScaledVector(axis, t);
      if (volume.sample(point.x, point.y, point.z) < -0.01) { touching = true; break; }
    }
    if (touching && !this.stroke) this.stroke = { origin: local.clone(), axis: axis.clone(), normal: normal.clone() };
    if (!this.stroke) { this.onMessage('Open palm ready · sweep the blade through the clay'); return; }
    const travel = local.clone().sub(this.stroke.origin).cross(axis).length();
    this.onMessage('Cutting · keep sweeping until the blade exits');
    if (!touching && travel > 0.2) {
      const cut = { n: normal.toArray(), d: -normal.dot(this.stroke.origin) };
      this.locked = true;
      this.blade.visible = false;
      this.stroke = null;
      this.commit(volume, cut);
    }
  }
  commit(volume, plane) {
    this.onBeforeCut(volume);
    volume.cutting = true;
    const revision = volume.cutRevision;
    this.onMessage('Finishing cut · comparing the two pieces');
    let worker;
    let timer;
    const finish = () => { clearTimeout(timer); worker?.terminate(); if (volume.cutRevision === revision) volume.cutting = false; };
    const fail = () => { finish(); this.onMessage('Cut could not finish · close your hand and try again'); };
    try {
      worker = new Worker(new URL('./knifeWorker.js', import.meta.url), { type: 'module' });
      timer = setTimeout(fail, 30000);
      worker.onerror = fail;
      worker.onmessage = ({ data }) => {
        finish();
        if (volume.cutRevision !== revision) return;
        if (data.error) { fail(); return; }
        if (!data.cut) { this.onMessage('Sweep farther through the clay to separate a piece'); return; }
        volume.applyKnifePlane(data.cut);
        this.onCut(volume);
        this.onMessage('Smaller piece removed · close and reopen your hand for another cut');
      };
      worker.postMessage({ state: volume.serialize(), ...plane });
    } catch { fail(); }
  }
}
