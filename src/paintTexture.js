import * as THREE from 'three';
import { trackingTrace } from './trackingTrace.js';
import { PaintTextureQueue } from './paintTextureQueue.js';
import { fillPaintTexture } from './paintTextureData.js';

export const canBuildPaintInWorker=volume=>typeof Worker!=='undefined' && typeof volume.serialize==='function';

function installTexture(state,plan,pixels) {
  const {min,size,spacing,signature,source,cut,extrude}=plan;
  state.texture?.dispose();
  state.texture=new THREE.Data3DTexture(pixels,...size);
  Object.assign(state.texture,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,unpackAlignment:1});
  Object.assign(state,{signature,source,cut,extrude});
  state.pendingBuild=false;
  state.uniforms.paintMap.value=state.texture;
  state.uniforms.paintOrigin.value.fromArray(min).addScalar(-spacing*.5);
  state.uniforms.paintExtent.value.set(...size.map(v=>v*spacing));
  state.texture.needsUpdate=true;state.uniforms.paintEnabled.value=1;
}

function completeBuild(state,result,plan) {
  installTexture(state,plan,result.pixels);
  trackingTrace.record('paint-texture-worker',{durationMs:result.durationMs,texels:result.pixels.length/4});
}

// Full inherited-paint sampling runs in a worker. Rendering keeps the previous
// complete texture until the latest complete revision is ready to swap in.
export function syncPaintTexture(state,volume,sample,hasPaint) {
  if(!state.dirty || state.disposed)return;
  const started=performance.now();state.dirty=false;
  if(!hasPaint(volume)) {
    state.queue?.invalidate();state.requested=null;state.bounds=null;state.completed=null;state.pendingBuild=false;
    state.uniforms.paintEnabled.value=0;return;
  }
  const cell=volume.paintCell ?? .02,bounds=new THREE.Box3();
  for(const id of volume.paint?.keys() ?? []) {
    const p=id.split(',').map(Number).map(v=>v*cell);
    bounds.expandByPoint(new THREE.Vector3(...p));
  }
  const inherited=[volume.pullSource,volume.cutSource,volume.extrudeSource].some(s=>s && hasPaint(s));
  if(inherited)for(const {mesh} of volume.bricks.values()) {
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox);
  }
  if(bounds.isEmpty()) {
    state.queue?.invalidate();state.requested=null;state.bounds=null;state.completed=null;state.pendingBuild=false;
    state.uniforms.paintEnabled.value=0;return;
  }
  const min=bounds.min.toArray().map(v=>Math.floor(Math.floor((v-cell*2)/.5)*.5/cell)*cell);
  const max=bounds.max.toArray().map(v=>Math.ceil(Math.ceil((v+cell*2)/.5)*.5/cell)*cell);
  let spacing=cell;
  const dimensions=()=>max.map((v,i)=>Math.ceil((v-min[i])/spacing)+1);
  let size=dimensions();
  while(size.some(v=>v>256) || size.reduce((a,b)=>a*b,1)>2_000_000){spacing*=2;size=dimensions();}
  const signature=JSON.stringify([min,size,spacing]);
  const plan={min,size,spacing,signature,source:volume.pullSource,cut:volume.cutSource,extrude:volume.extrudeSource};
  // Cleanup changes triangles, not pigment. Include an explicit paint revision
  // because editing a color need not change its Map identity or cell count.
  const content=[volume,volume.paint,volume.pullSource,volume.pullWarp,volume.cutSource,volume.cutRegion,volume.extrudeSource,volume.extrusion,state.paintRevision ?? 0,signature];
  if(state.requested?.every((v,i)=>v===content[i])) {
    if(state.completed)completeBuild(state,state.completed.result,state.completed.plan);
    state.completed=null;state.bounds=null;return;
  }
  state.completed=null;
  state.requested=content;state.queue?.invalidate();
  const rebuild=signature!==state.signature || state.source!==plan.source || state.cut!==plan.cut || state.extrude!==plan.extrude;
  // If a prior full revision is unfinished, a newer local stroke still needs
  // the whole latest revision; updating only its box would lose earlier ink.
  const dirty=!rebuild && !state.pendingBuild && state.bounds;
  const lo=dirty?dirty.min.toArray().map((v,i)=>Math.max(0,Math.floor((v-min[i])/spacing)-1)):[0,0,0];
  const hi=dirty?dirty.max.toArray().map((v,i)=>Math.min(size[i]-1,Math.ceil((v-min[i])/spacing)+1)):size.map(v=>v-1);
  state.bounds=null;
  const texels=size.reduce((a,b)=>a*b,1),updatedTexels=hi.reduce((a,v,i)=>a*Math.max(0,v-lo[i]+1),1);
  const sparse=rebuild && !inherited && spacing===cell;
  if(!sparse && updatedTexels>32768 && canBuildPaintInWorker(volume)) {
    state.queue ??=new PaintTextureQueue((result,context)=>{
      if(state.disposed)return;
      if(state.dirty){state.completed={result,plan:context};return;}
      completeBuild(state,result,context);
    },message=>{state.requested=null;trackingTrace.record('paint-texture-error',{message});});
    state.pendingBuild=true;
    state.queue.request({state:volume.serialize(),min,size,spacing},plan);
  } else {
    const pixels=rebuild?new Uint8Array(texels*4):state.texture.image.data;
    if(sparse)for(const [id,color] of volume.paint) {
      const p=id.split(',').map(Number).map((v,i)=>Math.round((v*cell-min[i])/spacing));
      const index=((p[2]*size[1]+p[1])*size[0]+p[0])*4;
      for(let c=0;c<4;c++)pixels[index+c]=Math.round(THREE.MathUtils.clamp(color[c],0,1)*255);
    } else fillPaintTexture(pixels,{min,size,spacing,lo,hi},(x,y,z)=>sample(volume,x,y,z));
    if(rebuild)installTexture(state,plan,pixels);
    else {state.pendingBuild=false;state.texture.needsUpdate=true;state.uniforms.paintEnabled.value=1;}
  }
  const durationMs=performance.now()-started;
  if(durationMs>16)trackingTrace.record('paint-texture-sync',{durationMs,inherited,rebuild,texels});
}
