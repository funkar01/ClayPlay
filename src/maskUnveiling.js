import * as THREE from 'three';
import {restoreSavedMask} from './savedMask.js';
import {enablePaintMaterial} from './paintLayer.js';

// Borrow geometry and materials; never deform or dispose the editable mask.
export class MaskUnveiling {
  constructor({stage,onOpen,onClose,onCollection,onSound}) {
    Object.assign(this,{onOpen,onClose,onCollection,onSound});this.seen=new Set();
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#201e35');
    this.camera=new THREE.PerspectiveCamera(38,1,.01,100);
    this.scene.add(new THREE.HemisphereLight(0xffecd9,0x7776b8,3));
    const key=new THREE.DirectionalLight(0xffe4c3,4);key.position.set(3,4,5);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0xb6b4ff,3);rim.position.set(-3,1,-2);this.scene.add(rim);
    const root=this.element=document.createElement('section');root.id='mask-unveiling';root.hidden=true;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','unveiling-title');
    root.innerHTML='<header><p>MADE BY YOU</p><h2 id="unveiling-title"></h2><p>Your imagination. Your mask.</p></header><footer><p role="status" aria-live="polite"></p><div><button type="button" data-reveal="close">Keep creating</button><button type="button" data-reveal="collection">My collection</button></div></footer>';
    stage.append(root);
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('click',event=>{const action=event.target.closest('[data-reveal]')?.dataset.reveal;if(!action)return;this.close();if(action==='collection')this.onCollection();});
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}
      if(event.key==='Tab'){event.preventDefault();const buttons=[...root.querySelectorAll('button')];buttons[document.activeElement===buttons[0]?1:0].focus();}
    });
  }
  get visible(){return !this.element.hidden;}
  open(item,pending){
    if(this.seen.has(pending.requestId))return;
    this.seen.add(pending.requestId);if(this.visible)this.close();
    this.previousFocus=document.activeElement;this.onOpen();
    this.owned=null;
    if(!item){
      const material=new THREE.MeshPhysicalMaterial({color:pending.record.color});enablePaintMaterial(material);
      item={group:new THREE.Group(),material,volume:{bricks:new Map()}};
      restoreSavedMask(item,pending.record);this.owned=item;
    }
    this.mask=item.group.clone(true);this.mask.position.set(0,0,0);this.mask.quaternion.identity();this.mask.scale.setScalar(1);this.mask.visible=true;
    const box=new THREE.Box3().setFromObject(this.mask),center=box.getCenter(new THREE.Vector3());
    this.mask.position.sub(center);this.pivot=new THREE.Group();this.pivot.add(this.mask);this.scene.add(this.pivot);
    this.size=box.getSize(new THREE.Vector3());this.started=performance.now();
    this.reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.element.querySelector('h2').textContent=pending.record.label;
    this.element.hidden=false;this.element.querySelector('button').focus({preventScroll:true});this.stopSound=this.onSound();
  }
  update(model){if(this.visible)this.element.querySelector('[role="status"]').textContent=model.message;}
  render(renderer,now){
    if(!this.visible)return;
    const {width,height}=renderer.domElement.getBoundingClientRect();this.camera.aspect=width/Math.max(1,height);
    // Leave room for the title and actions, including on narrow screens.
    const fit=Math.max(this.size.y/.48,this.size.x/(this.camera.aspect*.78),.5);
    this.camera.position.set(0,0,fit/(2*Math.tan(THREE.MathUtils.degToRad(19)))+this.size.z);
    this.camera.updateProjectionMatrix();
    const t=Math.min(1,(now-this.started)/2400);
    this.pivot.rotation.y=this.reduced?0:Math.sin(t*Math.PI*2)*.42*(1-t);
    renderer.render(this.scene,this.camera);
  }
  close(){if(!this.visible)return;this.stopSound?.();this.stopSound=null;this.element.hidden=true;this.scene.remove(this.pivot);this.pivot.clear();this.mask=null;
    if(this.owned){for(const {mesh} of this.owned.volume.bricks.values())mesh.geometry.dispose();this.owned.material.dispose();this.owned=null;}
    this.onClose();this.previousFocus?.focus?.({preventScroll:true});}
}
