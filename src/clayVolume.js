import * as THREE from 'three';
import { CLAY_SHAPES, EYE_SHAPES } from './clayShapes.js';
import { inverseWarp } from './maskWarp.js';
import { cutDistance } from './cutGeometry.js';
import { extrusionDistance, blendExtrusion } from './extrudeGeometry.js';
import { applyVertexPaint,PAINT_CELL } from './paintLayer.js';
import { applyExtrusionTint } from './extrusionTint.js';

const GRID_MIN = -2.4;
const GRID_CELLS = 192;
const GRID_NODES = GRID_CELLS + 1;
const VOXEL_SIZE = 0.025;
const BRICK_CELLS = 24;
const BRICK_COUNT = GRID_CELLS / BRICK_CELLS;
export const VOLUME_GRID = { min: GRID_MIN, cells: GRID_CELLS, voxel: VOXEL_SIZE, brick: BRICK_CELLS };
const TETRAHEDRA = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];
const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export class ClayVolume {
  constructor(parent, material, shape = 'full', meshQueueFactory = null, savedState = null) {
    this.parent = parent;
    this.material = material;
    this.field = new Map();
    this.bricks = new Map();
    if (meshQueueFactory) this.meshQueue = meshQueueFactory(this);
    if(savedState)Object.assign(this,ClayVolume.fromState(savedState));else this.reset(shape);
  }

  nodeKey(x, y, z) {
    // Keep existing compact keys in the original grid; sparse external nodes
    // use coordinates to avoid collisions as the editable mask grows.
    if(x<0 || y<0 || z<0 || x>GRID_CELLS || y>GRID_CELLS || z>GRID_CELLS) return `${x},${y},${z}`;
    return x + GRID_NODES * (y + GRID_NODES * z);
  }

  baseDistance(x, y, z) {
    if(this.extrudeSource) {
      const source=this.extrudeSource.sample(x,y,z);
      return blendExtrusion(source,extrusionDistance(x,y,z,this.extrusion,source+.035),this.extrusion.radii[0]);
    }
    let distance = this.pullSource
      ? this.pullSource.sample(...inverseWarp(x, y, z, this.pullWarp))
      : this.cutSource ? Math.max(this.cutSource.sample(x, y, z), cutDistance(x, y, z, this.cutRegion))
      : CLAY_SHAPES[this.shape].distance(x, y, z, this.eyeShape);
    return distance;
  }

  snapshot() {
    const field = Object.create(ClayVolume.prototype);
    field.shape = this.shape;
    field.eyeShape = this.eyeShape;
    field.extrudeSource=this.extrudeSource; field.extrusion=this.extrusion;
    field.field = new Map(this.field);
    field.paint=new Map(this.paint ?? []);
    field.paintCell=this.paintCell;
    field.pullSource = this.pullSource;
    field.pullWarp = this.pullWarp;
    field.cutSource = this.cutSource;
    field.cutRegion = this.cutRegion;
    return field;
  }

  serialize() {
    return { shape: this.shape, eyeShape: this.eyeShape, field: [...this.field], paint:[...(this.paint ?? [])], paintCell:this.paintCell, extrudeSource:this.extrudeSource?.serialize(), extrusion:this.extrusion,
      pullWarp: this.pullWarp, pullSource: this.pullSource?.serialize(),
      cutRegion: this.cutRegion, cutSource: this.cutSource?.serialize() };
  }

  static fromState(state) {
    const volume = Object.create(ClayVolume.prototype);
    Object.assign(volume, { shape: state.shape, eyeShape: state.eyeShape ?? 'oval', field: new Map(state.field),
      paint:new Map(state.paint ?? []),
      paintCell:state.paintCell ?? (state.paint?.length ? .05 : PAINT_CELL),
      extrudeSource:state.extrudeSource ? ClayVolume.fromState(state.extrudeSource) : null, extrusion:state.extrusion,
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
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);
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

  reset(shape = this.shape, eyeShape = CLAY_SHAPES[shape]?.eyeShape ?? this.eyeShape ?? 'oval') {
    this.paint=new Map();
    this.paintCell=PAINT_CELL;
    this.extrudeSource=null; this.extrusion=null;
    this.cutSource = null; this.cutRegion = null;
    this.pullSource = null;
    this.pullWarp = null;
    this.meshQueue?.reset();
    if (!Object.hasOwn(CLAY_SHAPES, shape)) throw new Error(`Unknown clay shape: ${shape}`);
    this.shape = shape;
    this.eyeShape = eyeShape;
    this.field.clear();
    const starter=CLAY_SHAPES[shape];
    if(starter.palette) {
      // Seed ordinary editable pigment, so history, deformation and saving use
      // exactly the same path as the creator's own brush strokes.
      this.paintCell=.05;
      const colors=starter.palette.map(hex=>[...new THREE.Color(hex).toArray(),1]);
      for(let iy=-36;iy<=42;iy++)for(let ix=-30;ix<=30;ix++) {
        const x=ix*this.paintCell,y=iy*this.paintCell;
        for(let iz=-18;iz<=23;iz++) {
          const z=iz*this.paintCell;
          if(starter.distance(x,y,z,eyeShape)>.09)continue;
          this.paint.set(`${ix},${iy},${iz}`,colors[starter.colorIndexAt?.(x,y) ?? Number(starter.accentAt(x,y))]);
        }
      }
    }
    this.rebuildSurface();
  }

  setEyeShape(eyes) {
    if (!Object.hasOwn(EYE_SHAPES,eyes)) throw new Error(`Unknown eye shape: ${eyes}`);
    // Clone nested sources so existing undo snapshots keep their original eyes.
    const withEyes = source => {
      if (!source) return source;
      const copy = source.snapshot(); copy.eyeShape = eyes;
      copy.pullSource = withEyes(source.pullSource);
      copy.cutSource = withEyes(source.cutSource);
      copy.extrudeSource = withEyes(source.extrudeSource);
      return copy;
    };
    this.eyeShape = eyes;
    this.pullSource = withEyes(this.pullSource);
    this.cutSource = withEyes(this.cutSource);
    this.extrudeSource = withEyes(this.extrudeSource);
    this.meshQueue?.reset();
    this.rebuildSurface();
  }

  rebuildSurface(clear = true) {
    const externalKeys=[...this.bricks.keys()].filter(key=>key.split(',').some(n=>Number(n)<0 || Number(n)>=BRICK_COUNT));
    if (clear) for (const brick of this.bricks.values()) {
      this.parent.remove(brick.mesh);
      brick.mesh.geometry.dispose();
    }
    if (clear) this.bricks.clear();
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
    for(const key of externalKeys) this.rebuildBrick(...key.split(',').map(Number));
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
    const endX = startX + BRICK_CELLS;
    const endY = startY + BRICK_CELLS;
    const endZ = startZ + BRICK_CELLS;
    const cornerPositions = CUBE_CORNERS.map(() => new THREE.Vector3());
    const cornerValues = new Float32Array(8);
    const meshStep=this.meshStep ?? 1;
    // Neighbouring cells/tetrahedra share grid nodes and crossing edges.
    // Evaluate their deformation chains and normals once per brick.
    const nodeStride=BRICK_CELLS+1, nodeCount=nodeStride**3;
    const nodeValues=new Float64Array(nodeCount);nodeValues.fill(NaN);
    const cornerIds=new Uint32Array(8), edges=new Map();

    const emitTriangle = (a, b, c, expectedNormal) => {
      const cross = b.position.clone().sub(a.position).cross(c.position.clone().sub(a.position));
      if(cross.lengthSq()<1e-20)return;
      if (cross.dot(expectedNormal) < 0) [b, c] = [c, b];
      for (const vertex of [a, b, c]) {
        positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
        normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
      }
    };

    const polygonizeTetrahedron = (tetra) => {
      // The intersection topology follows directly from the inside/outside
      // case. Angular sorting rebuilt vectors and evaluated atan2 for every
      // tetrahedron, despite these crossings already forming a known cycle.
      const inside=[],outside=[];
      for(const corner of tetra)(cornerValues[corner]<0?inside:outside).push(corner);
      if(!inside.length || !outside.length)return;
      const crossing=(cornerA,cornerB)=>{
        const valueA = cornerValues[cornerA];
        const valueB = cornerValues[cornerB];
        const idA=cornerIds[cornerA],idB=cornerIds[cornerB];
        const edgeKey=Math.min(idA,idB)*nodeCount+Math.max(idA,idB);
        let vertex=edges.get(edgeKey);
        if(!vertex) {
          const amount = THREE.MathUtils.clamp(valueA / (valueA - valueB), 0, 1);
          const position = cornerPositions[cornerA].clone().lerp(cornerPositions[cornerB], amount);
          vertex={position,normal:this.gradient(position.x,position.y,position.z)};
          edges.set(edgeKey,vertex);
        }
        return vertex;
      };
      let crossings;
      if(inside.length===1)crossings=outside.map(c=>crossing(inside[0],c));
      else if(outside.length===1)crossings=inside.map(c=>crossing(c,outside[0]));
      else crossings=[crossing(inside[0],outside[0]),crossing(inside[0],outside[1]),crossing(inside[1],outside[1]),crossing(inside[1],outside[0])];
      const normal=crossings.reduce((sum,item)=>sum.add(item.normal),new THREE.Vector3());
      emitTriangle(crossings[0],crossings[1],crossings[2],normal);
      if(crossings.length===4)emitTriangle(crossings[0],crossings[2],crossings[3],normal);
    };

    for (let z = startZ; z < endZ; z += meshStep) {
      for (let y = startY; y < endY; y += meshStep) {
        for (let x = startX; x < endX; x += meshStep) {
          let hasInside = false;
          let hasOutside = false;
          CUBE_CORNERS.forEach(([ox, oy, oz], cornerIndex) => {
            const gx = x + ox*meshStep;
            const gy = y + oy*meshStep;
            const gz = z + oz*meshStep;
            cornerPositions[cornerIndex].set(
              GRID_MIN + gx * VOXEL_SIZE,
              GRID_MIN + gy * VOXEL_SIZE,
              GRID_MIN + gz * VOXEL_SIZE,
            );
            const nodeId=(gx-startX)+nodeStride*((gy-startY)+nodeStride*(gz-startZ));
            cornerIds[cornerIndex]=nodeId;
            let value=nodeValues[nodeId];
            if(Number.isNaN(value))nodeValues[nodeId]=value=this.nodeValue(gx,gy,gz);
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
    if(this.material)applyVertexPaint(this,geometry);else applyExtrusionTint(this,geometry);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `ClayBrick_${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    this.bricks.set(key, { mesh });
  }

}
