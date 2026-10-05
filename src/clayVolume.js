import * as THREE from 'three';
import { CLAY_SHAPES } from './clayShapes.js';

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

function smoothStep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothMax(a, b, radius) {
  const blend = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.max(a, b) + (blend * blend * radius * 0.25);
}

export class ClayVolume {
  constructor(parent, material, shape = 'sphere', meshQueueFactory = null) {
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
    let distance = CLAY_SHAPES[this.shape].distance(x, y, z);
    for (const cut of this.cuts ?? []) distance = Math.max(distance, cut.n[0] * x + cut.n[1] * y + cut.n[2] * z + cut.d);
    return distance;
  }

  snapshot() {
    const field = Object.create(ClayVolume.prototype);
    field.shape = this.shape;
    field.cuts = structuredClone(this.cuts ?? []);
    field.field = new Map(this.field);
    return field;
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
    const gx = (x - GRID_MIN) / VOXEL_SIZE;
    const gy = (y - GRID_MIN) / VOXEL_SIZE;
    const gz = (z - GRID_MIN) / VOXEL_SIZE;
    if (gx < 0 || gy < 0 || gz < 0 || gx > GRID_CELLS || gy > GRID_CELLS || gz > GRID_CELLS) {
      return this.baseDistance(x, y, z);
    }
    const ix = Math.min(Math.floor(gx), GRID_CELLS - 1);
    const iy = Math.min(Math.floor(gy), GRID_CELLS - 1);
    const iz = Math.min(Math.floor(gz), GRID_CELLS - 1);
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
    this.cutRevision = (this.cutRevision ?? 0) + 1;
    this.cutting = false;
    this.cuts = [];
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

  applyKnifePlane(cut) {
    this.cuts.push(cut);
    // Bake the cut into edited samples; later sculpting can deform the new face.
    for (const [key, value] of this.field) {
      const x = key % GRID_NODES;
      const y = Math.floor(key / GRID_NODES) % GRID_NODES;
      const z = Math.floor(key / (GRID_NODES * GRID_NODES));
      const plane = cut.n[0] * (GRID_MIN + x * VOXEL_SIZE) + cut.n[1] * (GRID_MIN + y * VOXEL_SIZE) + cut.n[2] * (GRID_MIN + z * VOXEL_SIZE) + cut.d;
      this.field.set(key, Math.max(value, plane));
    }
    this.meshQueue?.reset();
    for (const [key, value] of this.field) this.meshQueue?.edit(key, value);
    for (let z = 0; z < BRICK_COUNT; z++) for (let y = 0; y < BRICK_COUNT; y++) for (let x = 0; x < BRICK_COUNT; x++) {
      const c = [x, y, z].map((v) => GRID_MIN + (v + 0.5) * BRICK_CELLS * VOXEL_SIZE);
      if (this.bricks.has(`${x},${y},${z}`) || this.sample(...c) < 0.6) this.rebuildBrick(x, y, z);
    }
  }

  rebuildBounds(min, max) {
    const minGrid = [min.x, min.y, min.z].map((value) => THREE.MathUtils.clamp(Math.floor((value - GRID_MIN) / VOXEL_SIZE) - 1, 0, GRID_CELLS));
    const maxGrid = [max.x, max.y, max.z].map((value) => THREE.MathUtils.clamp(Math.ceil((value - GRID_MIN) / VOXEL_SIZE) + 1, 0, GRID_CELLS));
    const minBrick = minGrid.map((value) => Math.max(0, Math.floor((value - 1) / BRICK_CELLS)));
    const maxBrick = maxGrid.map((value) => Math.min(BRICK_COUNT - 1, Math.floor(value / BRICK_CELLS)));
    for (let z = minBrick[2]; z <= maxBrick[2]; z += 1) {
      for (let y = minBrick[1]; y <= maxBrick[1]; y += 1) {
        for (let x = minBrick[0]; x <= maxBrick[0]; x += 1) this.rebuildBrick(x, y, z);
      }
    }
  }

  applyPull(previous, current, radius = 0.3, strength = 0.55) {
    const displacement = current.clone().sub(previous);
    const intensity = THREE.MathUtils.clamp(strength, 0, 1);
    if (intensity === 0) return false;
    const neutralIntensity = 0.4;
    const gain = intensity <= neutralIntensity
      ? THREE.MathUtils.lerp(0.25, 1, intensity / neutralIntensity)
      : THREE.MathUtils.lerp(1, 3, (intensity - neutralIntensity) / (1 - neutralIntensity));
    const maxDisplacement = intensity <= neutralIntensity
      ? THREE.MathUtils.lerp(0.035, 0.12, intensity / neutralIntensity)
      : THREE.MathUtils.lerp(0.12, 0.3, (intensity - neutralIntensity) / (1 - neutralIntensity));
    displacement.multiplyScalar(gain);
    const motion = displacement.length();
    if (motion < 0.0005) return false;
    if (motion > maxDisplacement) displacement.multiplyScalar(maxDisplacement / motion);
    const destination = previous.clone().add(displacement);
    // Leave a complete brush-width margin inside the editable volume.
    destination.clampScalar(GRID_MIN + radius, GRID_MIN + GRID_CELLS * VOXEL_SIZE - radius);
    displacement.copy(destination).sub(previous);
    const steps = Math.max(1, Math.ceil(displacement.length() / (VOXEL_SIZE * 1.5)));
    const step = displacement.clone().multiplyScalar(1 / steps);
    const reach = radius + VOXEL_SIZE;
    let changed = false;
    for (let strokeStep = 1; strokeStep <= steps; strokeStep += 1) {
      const center = previous.clone().addScaledVector(step, strokeStep);
      const min = new THREE.Vector3(center.x - reach, center.y - reach, center.z - reach);
      const max = new THREE.Vector3(center.x + reach, center.y + reach, center.z + reach);
      const minGrid = [min.x, min.y, min.z].map((value) => THREE.MathUtils.clamp(Math.floor((value - GRID_MIN) / VOXEL_SIZE), 0, GRID_CELLS));
      const maxGrid = [max.x, max.y, max.z].map((value) => THREE.MathUtils.clamp(Math.ceil((value - GRID_MIN) / VOXEL_SIZE), 0, GRID_CELLS));
      const edits = [];
      for (let z = minGrid[2]; z <= maxGrid[2]; z += 1) {
        for (let y = minGrid[1]; y <= maxGrid[1]; y += 1) {
          for (let x = minGrid[0]; x <= maxGrid[0]; x += 1) {
            const px = GRID_MIN + x * VOXEL_SIZE;
            const py = GRID_MIN + y * VOXEL_SIZE;
            const pz = GRID_MIN + z * VOXEL_SIZE;
            const distance = Math.hypot(px - center.x, py - center.y, pz - center.z);
            if (distance >= radius) continue;
            const influence = smoothStep01((radius - distance) / (radius * 0.7));
            const sourceX = px - step.x * influence;
            const sourceY = py - step.y * influence;
            const sourceZ = pz - step.z * influence;
            const oldValue = this.sample(px, py, pz);
            const newValue = this.sample(sourceX, sourceY, sourceZ);
            if (Math.abs(newValue - oldValue) < 1e-5) continue;
            edits.push([this.nodeKey(x, y, z), newValue]);
          }
        }
      }
      if (edits.length) changed = true;
      for (const [key, value] of edits) { this.field.set(key, value); this.meshQueue?.edit(key, value); }
    }
    if (!changed) return false;
    const boundsReach = radius + displacement.length() + VOXEL_SIZE * 2;
    this.rebuildBounds(
      new THREE.Vector3(Math.min(previous.x, destination.x) - boundsReach, Math.min(previous.y, destination.y) - boundsReach, Math.min(previous.z, destination.z) - boundsReach),
      new THREE.Vector3(Math.max(previous.x, destination.x) + boundsReach, Math.max(previous.y, destination.y) + boundsReach, Math.max(previous.z, destination.z) + boundsReach),
    );
    return destination;
  }

  carveStroke(start, end, radius = 0.105, depth = 0.105, smoothness = 0.035, normal = null) {
    return this.surfaceStroke(start, end, radius, depth, smoothness, normal, false);
  }

  surfaceStroke(start, end, radius, depth, smoothness, normal, additive) {
    if (depth <= 0 || radius <= 0) return false;
    const reach = Math.max(radius, depth) + smoothness;
    const min = new THREE.Vector3(Math.min(start.x, end.x) - reach, Math.min(start.y, end.y) - reach, Math.min(start.z, end.z) - reach);
    const max = new THREE.Vector3(Math.max(start.x, end.x) + reach, Math.max(start.y, end.y) + reach, Math.max(start.z, end.z) + reach);
    const minGrid = [min.x, min.y, min.z].map((value) => THREE.MathUtils.clamp(Math.floor((value - GRID_MIN) / VOXEL_SIZE), 0, GRID_CELLS));
    const maxGrid = [max.x, max.y, max.z].map((value) => THREE.MathUtils.clamp(Math.ceil((value - GRID_MIN) / VOXEL_SIZE), 0, GRID_CELLS));
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const surfaceNormal = normal ? normal.clone().normalize() : this.gradient(midpoint.x, midpoint.y, midpoint.z);
    if (surfaceNormal.lengthSq() < 1e-6) surfaceNormal.copy(midpoint).normalize();
    if (surfaceNormal.lengthSq() < 1e-6) surfaceNormal.set(0, 0, 1);
    const segment = end.clone().sub(start);
    segment.addScaledVector(surfaceNormal, -segment.dot(surfaceNormal));
    const segmentLength = segment.length();
    const tangent = segmentLength > 1e-5 ? segment.clone().multiplyScalar(1 / segmentLength)
      : new THREE.Vector3(Math.abs(surfaceNormal.x) < 0.8 ? 1 : 0, Math.abs(surfaceNormal.x) < 0.8 ? 0 : 1, 0).cross(surfaceNormal).normalize();
    const side = tangent.clone().cross(surfaceNormal).normalize();
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
    const safeDepth = Math.max(depth, VOXEL_SIZE * 0.5);
    const safeRadius = Math.max(radius, VOXEL_SIZE * 0.5);
    const smoothing = Math.max(0.004, Math.min(smoothness, safeDepth * 0.5, safeRadius * 0.5));
    const edits = [];
    for (let z = minGrid[2]; z <= maxGrid[2]; z += 1) {
      for (let y = minGrid[1]; y <= maxGrid[1]; y += 1) {
        for (let x = minGrid[0]; x <= maxGrid[0]; x += 1) {
          const px = GRID_MIN + x * VOXEL_SIZE;
          const py = GRID_MIN + y * VOXEL_SIZE;
          const pz = GRID_MIN + z * VOXEL_SIZE;
          const relativeX = px - start.x;
          const relativeY = py - start.y;
          const relativeZ = pz - start.z;
          const tangentPosition = relativeX * tangent.x + relativeY * tangent.y + relativeZ * tangent.z;
          const along = segmentLength > 1e-5 ? THREE.MathUtils.clamp(tangentPosition / segmentLength, 0, 1) : 0;
          const offsetX = relativeX - segment.x * along;
          const offsetY = relativeY - segment.y * along;
          const offsetZ = relativeZ - segment.z * along;
          const sideDistance = (offsetX * side.x + offsetY * side.y + offsetZ * side.z) / safeRadius;
          const normalDistance = (offsetX * surfaceNormal.x + offsetY * surfaceNormal.y + offsetZ * surfaceNormal.z) / safeDepth;
          const endDistance = Math.max(-tangentPosition, 0, tangentPosition - segmentLength);
          const capDistance = endDistance / safeRadius;
          const ellipseDistance = Math.hypot(sideDistance, normalDistance, capDistance);
          const brushDistance = (ellipseDistance - 1) * Math.min(safeRadius, safeDepth);
          if (brushDistance > smoothing) continue;
          const oldValue = this.nodeValue(x, y, z);
          const newValue = additive
            ? -smoothMax(-oldValue, -brushDistance, smoothing)
            : smoothMax(oldValue, -brushDistance, smoothing);
          if (Math.abs(newValue - oldValue) < 1e-5) continue;
          edits.push([this.nodeKey(x, y, z), newValue]);
        }
      }
    }
    if (!edits.length) return false;
    for (const [key, value] of edits) { this.field.set(key, value); this.meshQueue?.edit(key, value); }
    this.rebuildBounds(min, max);
    return true;
  }

  applyBulge(start, end, radius = 0.28, amount = 0.12, normal = null) {
    return this.surfaceStroke(start, end, radius, amount, 0.06, normal, true);
  }
}
