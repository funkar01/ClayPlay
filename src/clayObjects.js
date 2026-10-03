import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { CLAY_SHAPES } from './clayShapes.js';

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
    this.add('sphere', '#bd7455');
  }

  add(shape, color) {
    if (this.items.length >= this.limit || !Object.hasOwn(CLAY_SHAPES, shape)) return null;
    const group = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.78, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.9 });
    const id = this.nextId++;
    group.name = `ClayObject_${id}`;
    const item = { id, shape, label: `${CLAY_SHAPES[shape].label} ${id}`, group, material, volume: new ClayVolume(group, material, shape), edited: false };
    this.items.push(item);
    this.scene.add(group);
    this.active = item;
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
    for (const { mesh } of this.active.volume.bricks.values()) mesh.geometry.dispose();
    this.active.volume.field.clear();
    this.active.volume.bricks.clear();
    this.active.material.dispose();
    this.scene.remove(this.active.group);
    this.items.splice(index, 1);
    this.active = this.items[Math.min(index, this.items.length - 1)];
  }

  layout(camera) {
    const count = this.items.length;
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const columns = Math.min(count, 3, Math.max(1, Math.round(Math.sqrt(count * camera.aspect))));
    const rows = Math.ceil(count / columns);
    const cell = Math.min(3.3, height * camera.aspect * 0.82 / columns, height * 0.62 / rows);
    const scale = Math.min(1, cell / 3.3);
    this.items.forEach((item, index) => {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, count - row * columns);
      item.group.position.set(((index % columns) - (rowCount - 1) / 2) * cell, ((rows - 1) / 2 - row) * cell - 0.08, 0);
      item.group.scale.setScalar(scale);
      item.group.updateMatrixWorld(true);
    });
    this.updateMarker();
  }

  updateMarker() {
    this.marker.visible = this.items.length > 1;
    this.marker.position.copy(this.active.group.position);
    this.marker.position.y -= 1.5 * this.active.group.scale.x;
    this.marker.scale.copy(this.active.group.scale);
  }
}
