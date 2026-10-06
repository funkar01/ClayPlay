import * as THREE from 'three';
import { CLAY_SHAPES } from './clayShapes.js';
import { inverseWarp } from './maskWarp.js';
import { cutDistance } from './cutGeometry.js';

const GRID_MIN = -2.4;
const GRID_CELLS = 192;
const GRID_NODES = GRID_CELLS + 1;
const VOXEL_SIZE = 0.025;
const BRICK_CELLS = 24;
const BRICK_COUNT = GRID_CELLS / BRICK_CELLS;
const TETRAHEDRA = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];
const TETRA_EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export class ClayVolume {
  constructor(parent, material, shape = 'full', meshQueueFactory = null) {
    this.parent = parent;
    this.material = material;
    this.field = new Map();
    this.bricks = new Map();
    if (meshQueueFactory) this.meshQueue = meshQueueFactory(this);
    this.reset(shape);
  }

  nodeKey(x, y, z) {
    return x + GRID_NODES * (y + GRID_NODES * z);
  }

  baseDistance(x, y, z) {
    let distance = this.pullSource
      ? this.pullSource.sample(...inverseWarp(x, y, z, this.pullWarp))
      : this.cutSource ? Math.max(this.cutSource.sample(x, y, z), cutDistance(x, y, z, this.cutRegion))
      : CLAY_SHAPES[this.shape].distance(x, y, z);
    return distance;
  }

  snapshot() {
    const field = Object.create(ClayVolume.prototype);
    field.shape = this.shape;
    field.field = new Map(this.field);
    field.pullSource = this.pullSource;
    field.pullWarp = this.pullWarp;
    field.cutSource = this.cutSource;
    field.cutRegion = this.cutRegion;
    return field;
  }

  serialize() {
    return { shape: this.shape, field: [...this.field],
      pullWarp: this.pullWarp, pullSource: this.pullSource?.serialize(),
      cutRegion: this.cutRegion, cutSource: this.cutSource?.serialize() };
  }

  static fromState(state) {
    const volume = Object.create(ClayVolume.prototype);
    Object.assign(volume, { shape: state.shape, field: new Map(state.field),
      pullWarp: state.pullWarp, pullSource: state.pullSource ? ClayVolume.fromState(state.pullSource) : null,
      cutRegion: state.cutRegion, cutSource: state.cutSource ? ClayVolume.fromState(state.cutSource) : null });
    return volume;
  }

  nodeValue(ix, iy, iz) {
    const key = this.nodeKey(ix, iy, iz);
    const stored = this.field.get(key);
    if (stored !== undefined) return stored;
    return this.baseDistance(
      GRID_MIN + ix * VOXEL_SIZE,
      GRID_MIN + iy * VOXEL_SIZE,
      GRID_MIN + iz * VOXEL_SIZE,
    );
  }

  sample(x, y, z) {
    // Empty overlays can sample their analytic source directly. This prevents
    // repeated mask pulls from multiplying recursive grid evaluations.
    if (!this.field.size) return this.baseDistance(x, y, z);
    const gx = (x - GRID_MIN) / VOXEL_SIZE;
    const gy = (y - GRID_MIN) / VOXEL_SIZE;
    const gz = (z - GRID_MIN) / VOXEL_SIZE;
    if (gx < 0 || gy < 0 || gz < 0 || gx > GRID_CELLS || gy > GRID_CELLS || gz > GRID_CELLS) {
      return this.baseDistance(x, y, z);
    }
    const ix = Math.min(Math.floor(gx), GRID_CELLS - 1);
    const iy = Math.min(Math.floor(gy), GRID_CELLS - 1);
    const iz = Math.min(Math.floor(gz), GRID_CELLS - 1);
    let editedCell = false;
    for (let oz = 0; oz <= 1; oz++) for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
      if (this.field.has(this.nodeKey(ix + ox, iy + oy, iz + oz))) editedCell = true;
    }
    if (!editedCell) return this.baseDistance(x, y, z);
    const tx = gx - ix;
    const ty = gy - iy;
    const tz = gz - iz;
    const c00 = THREE.MathUtils.lerp(this.nodeValue(ix, iy, iz), this.nodeValue(ix + 1, iy, iz), tx);
    const c10 = THREE.MathUtils.lerp(this.nodeValue(ix, iy + 1, iz), this.nodeValue(ix + 1, iy + 1, iz), tx);
    const c01 = THREE.MathUtils.lerp(this.nodeValue(ix, iy, iz + 1), this.nodeValue(ix + 1, iy, iz + 1), tx);
    const c11 = THREE.MathUtils.lerp(this.nodeValue(ix, iy + 1, iz + 1), this.nodeValue(ix + 1, iy + 1, iz + 1), tx);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(c00, c10, ty), THREE.MathUtils.lerp(c01, c11, ty), tz);
  }

  gradient(x, y, z) {
    const h = VOXEL_SIZE * 0.5;
    return new THREE.Vector3(
      this.sample(x + h, y, z) - this.sample(x - h, y, z),
      this.sample(x, y + h, z) - this.sample(x, y - h, z),
      this.sample(x, y, z + h) - this.sample(x, y, z - h),
    ).normalize();
  }

  reset(shape = this.shape) {
    this.cutSource = null; this.cutRegion = null;
    this.pullSource = null;
    this.pullWarp = null;
    this.meshQueue?.reset();
    if (!Object.hasOwn(CLAY_SHAPES, shape)) throw new Error(`Unknown clay shape: ${shape}`);
    this.shape = shape;
    this.field.clear();
    for (const brick of this.bricks.values()) {
      this.parent.remove(brick.mesh);
      brick.mesh.geometry.dispose();
    }
    this.bricks.clear();
    const halfBrick = BRICK_CELLS * VOXEL_SIZE * Math.sqrt(3) * 0.5;
    for (let z = 0; z < BRICK_COUNT; z += 1) {
      for (let y = 0; y < BRICK_COUNT; y += 1) {
        for (let x = 0; x < BRICK_COUNT; x += 1) {
          const centerX = GRID_MIN + (x * BRICK_CELLS + BRICK_CELLS * 0.5) * VOXEL_SIZE;
          const centerY = GRID_MIN + (y * BRICK_CELLS + BRICK_CELLS * 0.5) * VOXEL_SIZE;
          const centerZ = GRID_MIN + (z * BRICK_CELLS + BRICK_CELLS * 0.5) * VOXEL_SIZE;
          const shellDistance = Math.abs(this.baseDistance(centerX, centerY, centerZ));
          if (shellDistance <= halfBrick + VOXEL_SIZE) this.rebuildBrick(x, y, z);
        }
      }
    }
  }

  rebuildBrick(bx, by, bz) {
    const key = `${bx},${by},${bz}`;
    if (this.meshQueue) { this.meshQueue.brick(key); return; }
    const old = this.bricks.get(key);
    if (old) {
      this.parent.remove(old.mesh);
      old.mesh.geometry.dispose();
      this.bricks.delete(key);
    }

    const positions = [];
    const normals = [];
    const startX = bx * BRICK_CELLS;
    const startY = by * BRICK_CELLS;
    const startZ = bz * BRICK_CELLS;
    const endX = Math.min(startX + BRICK_CELLS, GRID_CELLS);
    const endY = Math.min(startY + BRICK_CELLS, GRID_CELLS);
    const endZ = Math.min(startZ + BRICK_CELLS, GRID_CELLS);
    const cornerPositions = CUBE_CORNERS.map(() => new THREE.Vector3());
    const cornerValues = new Float32Array(8);

    const emitTriangle = (a, b, c, expectedNormal) => {
      const cross = b.position.clone().sub(a.position).cross(c.position.clone().sub(a.position));
      if (cross.dot(expectedNormal) < 0) [b, c] = [c, b];
      for (const vertex of [a, b, c]) {
        positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
        normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
      }
    };

    const polygonizeTetrahedron = (tetra) => {
      const crossings = [];
      for (const [edgeA, edgeB] of TETRA_EDGES) {
        const cornerA = tetra[edgeA];
        const cornerB = tetra[edgeB];
        const valueA = cornerValues[cornerA];
        const valueB = cornerValues[cornerB];
        if ((valueA < 0) === (valueB < 0)) continue;
        const amount = THREE.MathUtils.clamp(valueA / (valueA - valueB), 0, 1);
        const position = cornerPositions[cornerA].clone().lerp(cornerPositions[cornerB], amount);
        if (crossings.some((item) => item.position.distanceToSquared(position) < 1e-10)) continue;
        crossings.push({ position, normal: this.gradient(position.x, position.y, position.z) });
      }
      if (crossings.length < 3) return;
      const center = crossings.reduce((sum, item) => sum.add(item.position), new THREE.Vector3()).multiplyScalar(1 / crossings.length);
      const averageNormal = crossings.reduce((sum, item) => sum.add(item.normal), new THREE.Vector3()).normalize();
      if (averageNormal.lengthSq() < 1e-6) averageNormal.copy(center).normalize();
      const basis = Math.abs(averageNormal.x) < 0.8
        ? new THREE.Vector3(1, 0, 0).cross(averageNormal).normalize()
        : new THREE.Vector3(0, 1, 0).cross(averageNormal).normalize();
      const secondBasis = averageNormal.clone().cross(basis).normalize();
      crossings.sort((a, b) => {
        const aOffset = a.position.clone().sub(center);
        const bOffset = b.position.clone().sub(center);
        const angleA = Math.atan2(aOffset.dot(secondBasis), aOffset.dot(basis));
        const angleB = Math.atan2(bOffset.dot(secondBasis), bOffset.dot(basis));
        return angleA - angleB;
      });
      for (let index = 1; index < crossings.length - 1; index += 1) {
        emitTriangle(crossings[0], crossings[index], crossings[index + 1], averageNormal);
      }
    };

    for (let z = startZ; z < endZ; z += 1) {
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          let hasInside = false;
          let hasOutside = false;
          CUBE_CORNERS.forEach(([ox, oy, oz], cornerIndex) => {
            const gx = x + ox;
            const gy = y + oy;
            const gz = z + oz;
            cornerPositions[cornerIndex].set(
              GRID_MIN + gx * VOXEL_SIZE,
              GRID_MIN + gy * VOXEL_SIZE,
              GRID_MIN + gz * VOXEL_SIZE,
            );
            const value = this.nodeValue(gx, gy, gz);
            cornerValues[cornerIndex] = value;
            if (value < 0) hasInside = true;
            else hasOutside = true;
          });
          if (!hasInside || !hasOutside) continue;
          for (const tetrahedron of TETRAHEDRA) polygonizeTetrahedron(tetrahedron);
        }
      }
    }
    if (!positions.length) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `ClayBrick_${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    this.bricks.set(key, { mesh });
  }

}
