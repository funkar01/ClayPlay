import * as THREE from 'three';
import { cameraCoverPoint } from './arView.js';

// All three starter masks use these eye centers, even after sculpting/cutting.
const eyeSpacing = 0.92;
const eyeCenter = new THREE.Vector3(0, 0.35, 0.43);

export function faceMaskPose(result, sourceWidth, sourceHeight, viewWidth, viewHeight) {
  const points = result.faceLandmarks?.[0];
  if (!points || !sourceWidth || !sourceHeight || !viewWidth || !viewHeight) return null;
  const average = (a, b) => {
    if (!points[a] || !points[b]) return null;
    const p = { x: (points[a].x + points[b].x) / 2, y: (points[a].y + points[b].y) / 2 };
    const mapped = cameraCoverPoint(p, sourceWidth, sourceHeight, viewWidth, viewHeight);
    return new THREE.Vector3((mapped.x * 2 - 1) * viewWidth / viewHeight, 1 - mapped.y * 2, 0);
  };
  const left = average(263, 362), right = average(33, 133);
  if (!left || !right) return null;
  const line = right.clone().sub(left), separation = line.length();
  if (!Number.isFinite(separation) || separation < 0.025 || line.x <= 0) return null;
  const data = result.facialTransformationMatrixes?.[0]?.data;
  const rotation = new THREE.Matrix4();
  if (data?.length === 16 && data.every(Number.isFinite)) {
    rotation.extractRotation(new THREE.Matrix4().fromArray(data));
    // Mirror the head rotation to match the front-camera background.
    for (const i of [1, 2, 4, 8]) rotation.elements[i] *= -1;
    if (!Number.isFinite(rotation.determinant()) || Math.abs(rotation.determinant() - 1) > 0.1) return null;
  }
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotation);
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const projectedWidth = Math.hypot(axis.x, axis.y);
  if (projectedWidth < 0.2) return null;
  // Use the actual eye line for roll/alignment; the matrix supplies yaw/pitch.
  quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1),
    Math.atan2(line.y, line.x) - Math.atan2(axis.y, axis.x)));
  const scale = separation / (eyeSpacing * projectedWidth);
  const position = left.clone().add(right).multiplyScalar(0.5)
    .sub(eyeCenter.clone().applyQuaternion(quaternion).multiplyScalar(scale));
  return { position, quaternion, scale };
}

export class MaskTryOn {
  constructor(lights) {
    this.enabled = false;
    this.scene = new THREE.Scene();
    lights.forEach(light => this.scene.add(light.clone()));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.z = 10;
    this.mask = new THREE.Group(); this.mask.visible = false; this.scene.add(this.mask);
    this.meshes = new Map(); this.receivedAt = -Infinity;
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this.target = null; this.displayed = null; this.result = null;
    this.receivedAt = -Infinity; this.mask.visible = false;
    if (!enabled) { this.mask.clear(); this.meshes.clear(); this.item = null; }
  }
  setItem(item) {
    if (this.item === item && this.meshes.size === item.volume.bricks.size
      && [...item.volume.bricks].every(([key, { mesh }]) => this.meshes.get(key) === mesh)) return;
    // Share the finished geometry and material: trying a mask never edits it.
    this.mask.clear(); this.meshes.clear(); this.item = item;
    for (const [key, { mesh }] of item.volume.bricks) {
      this.mask.add(mesh.clone()); this.meshes.set(key, mesh);
    }
  }
  resize(width, height) {
    const aspect = width / height;
    this.camera.left = -aspect; this.camera.right = aspect; this.camera.updateProjectionMatrix();
    this.width = width; this.height = height;
    if (this.result) this.target = faceMaskPose(this.result, this.sourceWidth, this.sourceHeight, width, height);
    this.displayed = null;
  }
  receive(result, now, sourceWidth, sourceHeight) {
    if (!this.enabled) return;
    this.result = result; this.sourceWidth = sourceWidth; this.sourceHeight = sourceHeight;
    this.target = faceMaskPose(result, sourceWidth, sourceHeight, this.width, this.height);
    if (this.target) this.receivedAt = now;
  }
  update(now, dt) {
    if (!this.enabled) return false;
    const visible = now - this.receivedAt < 300;
    if (visible && this.target) {
      if (!this.displayed) this.displayed = { position: this.target.position.clone(), quaternion: this.target.quaternion.clone(), scale: this.target.scale };
      const blend = 1 - Math.exp(-dt / 0.04);
      this.displayed.position.lerp(this.target.position, blend);
      this.displayed.quaternion.slerp(this.target.quaternion, blend);
      this.displayed.scale = THREE.MathUtils.lerp(this.displayed.scale, this.target.scale, blend);
      this.mask.position.copy(this.displayed.position); this.mask.quaternion.copy(this.displayed.quaternion);
      this.mask.scale.setScalar(this.displayed.scale);
    }
    if (!visible) this.displayed = null;
    this.mask.visible = visible;
    return visible;
  }
}
