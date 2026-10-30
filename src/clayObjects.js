import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { CLAY_SHAPES } from './clayShapes.js';
import { attachMeshQueue } from './meshQueue.js';
import { PullPreview } from './pullPreview.js';
import { DEFAULT_CLAY_COLOR } from './clayAppearance.js';
import { enablePaintMaterial } from './paintLayer.js';
import { restoreSavedMask,validateSavedMask } from './savedMask.js';

export class ClayObjects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.nextId = 1;
    this.limit = 8;
    const points = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 1.4, Math.sin(angle) * 0.16, 0);
    });
    this.marker = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: '#ad684d', transparent: true, opacity: 0.7 }),
    );
    scene.add(this.marker);
    this.add('full', DEFAULT_CLAY_COLOR);
  }

  add(shape, color, {saved=null}={}) {
    if(saved && !validateSavedMask(saved))throw new Error('This saved mask could not be opened.');
    if (this.items.length >= this.limit || !Object.hasOwn(CLAY_SHAPES, shape)) return null;
    const group = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({ color, roughness: this.active?.material.roughness ?? 0.78, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.9 });
    enablePaintMaterial(material);
    const id = this.nextId++;
    group.name = `ClayObject_${id}`;
    const item = { id, shape, label: `${CLAY_SHAPES[shape].label} ${id}`, group, material, volume: new ClayVolume(group, material, shape, attachMeshQueue,saved?.state), edited: false };
    item.volume.pullPreview = new PullPreview(material);
    if(saved)restoreSavedMask(item,saved);
    this.items.push(item);
    this.scene.add(group);
    this.active = item;
    this.updateMarker();
    return item;
  }

  select(id) {
    const item = this.items.find((item) => item.id === Number(id));
    if (item) this.active = item;
    this.updateMarker();
    return this.active;
  }

  removeActive() {
    if (this.items.length === 1) return;
    const index = this.items.indexOf(this.active);
    this.active.volume.surfacePaint?.finish();
    this.active.volume.surfacePull?.abort();
    this.active.volume.surfaceExtrude?.abort();
    this.active.volume.surfaceCut?.abort();
    this.active.volume.surfaceErase?.abort();
    this.active.volume.meshQueue?.dispose();
    this.active.volume.erasePreview?.dispose();
    for (const { mesh } of this.active.volume.bricks.values()) mesh.geometry.dispose();
    this.active.volume.field.clear();
    this.active.volume.bricks.clear();
    this.active.material.dispose();
    this.scene.remove(this.active.group);
    this.items.splice(index, 1);
    this.active = this.items[Math.min(index, this.items.length - 1)];
    this.updateMarker();
  }

  layout(camera) {
    // Saved masks stay available in the menu; only the selection occupies the stage.
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const cell = Math.min(3.3, height * camera.aspect * 0.82, height * 0.62);
    const scale = Math.min(1, cell / 3.3);
    this.items.forEach((item) => {
      const position = [0, -0.08, 0];
      item.volume.layoutPosition = position;
      const offset = item.volume.userOffset ?? [0, 0];
      item.group.position.set(position[0] + offset[0], position[1] + offset[1], position[2]);
      item.volume.layoutScale = scale;
      item.group.scale.setScalar(scale * (item.volume.userScale ?? 1));
      item.group.updateMatrixWorld(true);
    });
    this.updateMarker();
  }

  updateMarker() {
    for (const item of this.items) item.group.visible = item === this.active;
    this.marker.visible = false;
    this.marker.position.copy(this.active.group.position);
    this.marker.position.y -= 1.5 * this.active.group.scale.x;
    this.marker.scale.copy(this.active.group.scale);
  }
}
