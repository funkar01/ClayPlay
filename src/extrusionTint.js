import * as THREE from 'three';
import { extrusionMaterialTree,extrusionMaterialColor,partitionExtrusionMaterials } from './extrusionMaterials.js';

// Material ownership is resolved in the background mesh pass. Boundary faces
// are split so the mask and extrusion retain distinct, fully opaque colors.
export function extrusionTintSampler(volume) {
  const tree=extrusionMaterialTree(volume);
  return tree && ((x,y,z)=>extrusionMaterialColor(tree,x,y,z));
}

export function applyExtrusionTint(volume,geometry) {
  if(geometry.getAttribute('extrudeColor')?.count===geometry.attributes.position.count)return;
  const tree=extrusionMaterialTree(volume);if(!tree)return;
  if(partitionExtrusionMaterials(geometry,tree))return;
  // Point-only and indexed preview geometry retain their original topology.
  const positions=geometry.attributes.position,colors=new Float32Array(positions.count*4);
  for(let i=0;i<positions.count;i++)colors.set(extrusionMaterialColor(tree,positions.getX(i),positions.getY(i),positions.getZ(i)),i*4);
  geometry.setAttribute('extrudeColor',new THREE.BufferAttribute(colors,4));
}
