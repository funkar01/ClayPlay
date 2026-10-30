import * as THREE from 'three';
import { ClayVolume } from './clayVolume.js';
import { MASK_SHAPES,EYE_SHAPES } from './clayShapes.js';
import { applyVertexPaint } from './paintLayer.js';

export function captureSavedMask(item) {
  return {version:1,label:item.label,shape:item.volume.shape,color:`#${item.material.color.getHexString()}`,
    roughness:item.material.roughness,scale:item.volume.userScale ?? 1,offset:[...(item.volume.userOffset ?? [0,0])],
    state:item.volume.serialize(),bricks:[...item.volume.bricks].map(([key,{mesh}])=>({key,
      positions:mesh.geometry.attributes.position.array.slice(),normals:mesh.geometry.attributes.normal.array.slice()}))};
}
export function validateSavedMask(record) {
  if(!record || record.version!==1 || !Object.hasOwn(MASK_SHAPES,record.shape)
    || typeof record.label!=='string' || record.label.length>120 || !/^#[\da-f]{6}$/i.test(record.color)
    || !Number.isFinite(record.roughness) || record.roughness<0 || record.roughness>1
    || !Number.isFinite(record.scale) || record.scale<=0 || !Array.isArray(record.offset) || record.offset.length!==2 || !record.offset.every(Number.isFinite)
    || record.state?.shape!==record.shape || !Array.isArray(record.bricks))return false;
  const states=[record.state],seen=new Set();
  while(states.length) {
    const state=states.pop();if(!state || seen.has(state) || seen.size>100)return false;seen.add(state);
    if(!Object.hasOwn(MASK_SHAPES,state.shape) || !Object.hasOwn(EYE_SHAPES,state.eyeShape ?? 'oval')
      || !Array.isArray(state.field) || !state.field.every(e=>Array.isArray(e)&&e.length===2&&Number.isFinite(e[1]))
      || (state.paint && (!Array.isArray(state.paint)||!state.paint.every(e=>Array.isArray(e)&&e.length===2&&Array.isArray(e[1])&&e[1].length===4&&e[1].every(Number.isFinite)))))return false;
    for(const key of ['pullSource','cutSource','extrudeSource'])if(state[key])states.push(state[key]);
  }
  return record.bricks.every(b=>typeof b.key==='string' && b.positions instanceof Float32Array && b.normals instanceof Float32Array
    && b.positions.length===b.normals.length && b.positions.length%3===0 && b.positions.every(Number.isFinite)&&b.normals.every(Number.isFinite));
}
export function restoreSavedMask(item,record) {
  if(!validateSavedMask(record))throw new Error('This saved mask could not be opened. Its online copy has been kept.');
  Object.assign(item.volume,ClayVolume.fromState(record.state));
  item.label=record.label;item.edited=true;item.material.roughness=record.roughness;
  item.volume.userScale=record.scale;item.volume.userOffset=[...record.offset];
  item.volume.undoStack=[];item.volume.redoStack=[];
  for(const brick of record.bricks) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(brick.positions.slice(),3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(brick.normals.slice(),3));
    geometry.computeBoundingSphere();applyVertexPaint(item.volume,geometry);
    const mesh=new THREE.Mesh(geometry,item.material);mesh.name=`ClayBrick_${brick.key}`;
    item.group.add(mesh);item.volume.bricks.set(brick.key,{mesh});
  }
}
