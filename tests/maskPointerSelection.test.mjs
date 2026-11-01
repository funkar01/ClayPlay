import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf("sceneHost.addEventListener('pointerdown',");
const handler=source.slice(start,source.indexOf('\n});',start)+4);

for(const visible of [false,true])test(`A ${visible?'visible':'hidden saved'} mask ${visible?'can':'cannot'} take a click from the current mask`,()=>{
  const make=(id,z)=>{
    const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial()));
    group.position.z=z;group.updateMatrixWorld(true);return {id,group};
  };
  const old=make(1,1),current=make(2,0);old.group.visible=visible;
  const ray=new THREE.Raycaster(new THREE.Vector3(0,0,5),new THREE.Vector3(0,0,-1));
  // Demonstrate why raycasting all saved masks is unsafe: visibility alone
  // does not prevent Three.js from intersecting the older, closer surface.
  assert.equal(ray.intersectObjects([old.group,current.group],true)[0].object.parent,old.group);
  const selected=[],sculpted=[],canvas={};let down;
  const context=vm.createContext({
    tryOn:{enabled:false},renderer:{domElement:canvas},mousePointerId:null,cameraOpening:false,
    updateMouseTarget(){},clayRaycaster:ray,clayObjects:{items:[old,current],active:current},
    selectClayObject:id=>selected.push(id),cursorInputEnabled:()=>true,clayMenu:{isOpen:false},volumeBusy:()=>false,
    cancelMouseStroke(){},mousePinching:false,mouseSculptPoint:{x:0,y:0,z:0},
    sceneHost:{addEventListener(type,fn){down=fn;},setPointerCapture(){}},
    processSculptPoint:(point,held)=>sculpted.push(held),
  });
  vm.runInContext(handler,context);
  down({target:canvas,button:0,pointerId:7,preventDefault(){}});
  assert.deepEqual(selected,visible?[1]:[]);
  assert.deepEqual(sculpted,visible?[]:[true],'a hidden older mask must not steal the deformation');
  for(const item of [old,current])for(const mesh of item.group.children){mesh.geometry.dispose();mesh.material.dispose();}
});
