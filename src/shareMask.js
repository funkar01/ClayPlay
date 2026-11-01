import * as THREE from 'three';
import { restoreSavedMask } from './savedMask.js';
import { enablePaintMaterial } from './paintLayer.js';

// Render the saved design without loading it onto or changing the user's stage.
export async function maskShareFile(saved) {
  const record=saved.record,scene=new THREE.Scene(),group=new THREE.Group();
  const material=new THREE.MeshPhysicalMaterial({color:record.color,roughness:record.roughness,side:THREE.DoubleSide});
  enablePaintMaterial(material);
  const item={group,material,volume:{bricks:new Map()}};let renderer;
  try {
    restoreSavedMask(item,record);scene.add(group);scene.background=new THREE.Color('#100b26');
    const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    group.position.sub(center);
    scene.add(new THREE.HemisphereLight('#fff9f2','#c4a895',2.2));
    const light=new THREE.DirectionalLight('#fffaf2',2.8);light.position.set(-3,4,6);scene.add(light);
    const camera=new THREE.PerspectiveCamera(35,1,.01,1000);
    camera.position.z=Math.max(size.x,size.y)/2/Math.tan(THREE.MathUtils.degToRad(17.5))*1.25+size.z/2;
    renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1024,1024);
    renderer.render(scene,camera);
    const blob=await new Promise((resolve,reject)=>renderer.domElement.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare your mask image.')),'image/png'));
    return new File([blob],`${record.label.replace(/[^\p{L}\p{N} _-]/gu,'').trim()||'My mask'}.png`,{type:'image/png'});
  } finally {group.traverse(node=>node.geometry?.dispose());material.dispose();renderer?.dispose();}
}
