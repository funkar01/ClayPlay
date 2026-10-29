// Run manually: node tests/deformationBenchmark.mjs [report.json]
// Real worker computations; camera/GPU/frame latency needs browser validation.
import {Worker} from 'node:worker_threads';
import {writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {ClayVolume} from '../src/clayVolume.js';
import {makeWarp} from '../src/maskWarp.js';
import {taperedStroke} from '../src/extrudeGeometry.js';
import {surfaceBrickKeys,spanningSurfaceRegions,expandSurfaceRebuildKeys} from '../src/surfaceBricks.js';
import {paintSegment} from '../src/paintLayer.js';
import {PullPreview} from '../src/pullPreview.js';
import {SurfaceExtrude} from '../src/surfaceExtrude.js';

const report={runtime:process.version,measuredAt:new Date().toISOString(),measurements:[]};
const time=async(name,run)=>{const start=performance.now();const detail=await run();const row={name,wallMs:+(performance.now()-start).toFixed(2),...detail};report.measurements.push(row);console.log(JSON.stringify(row));};
function worker(file) {
  const w=new Worker(new URL('./helpers/browserWorker.mjs',import.meta.url),{workerData:{url:new URL(`../src/${file}`,import.meta.url).href}});
  return {send(data,timeout=60000){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('Worker exceeded benchmark deadline'));},timeout);
    const message=value=>{if(value.progress!==undefined)return;cleanup();value.error?reject(Error(value.error)):resolve(value);};
    const error=err=>{cleanup();reject(err);};
    const cleanup=()=>{clearTimeout(timer);w.off('message',message);w.off('error',error);};
    w.on('message',message);w.on('error',error);w.postMessage(data);
  });},post:data=>w.postMessage(data),close:()=>w.terminate()};
}
const material=new THREE.MeshBasicMaterial();
const volume=new ClayVolume(new THREE.Group(),material,'animal');
const bricks=[...volume.bricks].map(([key,{mesh}])=>({key,positions:mesh.geometry.attributes.position.array.slice(),normals:mesh.geometry.attributes.normal.array.slice()}));
const warp=makeWarp([.65,0,.65],[.7,.05,.04],.336,.55,true),eye=[0,0,8.6],planeZ=.9;
await time('Pull / live preview CPU update (excludes GPU)',()=>{
  const material=new THREE.MeshBasicMaterial(),preview=new PullPreview(material);
  preview.begin(warp);preview.update(warp);preview.tick(performance.now());preview.clear();material.dispose();
});
await time('Extrude / live preview CPU update (excludes GPU)',()=>{
  const previousDocument=globalThis.document;globalThis.document ??=new EventTarget();
  const previewVolume=ClayVolume.fromState(volume.serialize());
  Object.assign(previewVolume,{parent:new THREE.Group(),material,bricks:new Map()});
  const preview=new SurfaceExtrude(previewVolume,()=>{});
  preview.begin(new THREE.Vector3(.7,.5,.6),.25,true);preview.update(new THREE.Vector3(.9,.9,.7));preview.abort();
  globalThis.document=previousDocument;
});
let pulled;
await time('Pull / worker cold start + commit',async()=>{
  const w=worker('pullWorker.js');try {
    w.post({type:'begin',bricks,anchor:warp.center,symmetry:true});
    pulled=await w.send({type:'preview',warp,final:true});
    return {workerMs:pulled.duration,triangles:pulled.bricks.reduce((n,b)=>n+b.positions.length/9,0),steps:warp.steps.length};
  }finally{await w.close();}
});
const pulledVolume=ClayVolume.fromState({shape:'animal',field:[]});
Object.assign(pulledVolume,{pullSource:volume.snapshot(),pullWarp:warp,bricks:new Map(pulled.bricks.map(b=>[b.key,{mesh:{geometry:{attributes:{position:{array:b.positions}}}}}]))});
await time('Pull / optional remesh',async()=>{
  const w=worker('meshWorker.js'),regions=spanningSurfaceRegions(pulled.bricks),keys=[...expandSurfaceRebuildKeys(pulled.repairKeys ?? surfaceBrickKeys(pulledVolume.bricks),regions)];let workerMs=0,completed=0;const start=performance.now();
  try {
    for(let i=0;i<keys.length;i+=2) {
      if(performance.now()-start>15000)return {overBudget:true,completed,totalKeys:keys.length,workerMs};
      const r=await w.send({id:1,generation:0,shape:'animal',state:i===0?pulledVolume.serialize():undefined,keys:keys.slice(i,i+2),edits:[],reset:i===0,step:1},20000);
      workerMs+=r.duration;completed+=r.bricks.length;
    }
    return {workerMs,completed,totalKeys:keys.length};
  }catch(error){return {overBudget:true,completed,totalKeys:keys.length,error:error.message};}finally{await w.close();}
});
for(const [name,source]of [['fresh',volume],['after pull',pulledVolume]]) {
  await time(`Erase / ${name}`,async()=>{
    const w=worker('eraseWorker.js');try {
      w.post({type:'begin',state:source.serialize(),bricks:name==='fresh'?bricks:pulled.bricks,radius:.12,eye,planeZ,symmetry:true});
      const r=await w.send({type:'erase',points:[[.4,-.3],[.6,-.3]],breakBefore:true});
      return {workerMs:r.duration,changedBricks:r.bricks.length};
    }finally{await w.close();}
  });
  await time(`Extrude / ${name}`,async()=>{
    const state=source.serialize(),v=ClayVolume.fromState({shape:'animal',field:[]});
    v.extrudeSource=ClayVolume.fromState(state);v.extrusion=taperedStroke([[.7,.5,.6],[.9,.9,.7]],.1,true);
    const w=worker('meshWorker.js');try {
      const r=await w.send({id:1,generation:0,shape:'animal',state:v.serialize(),keys:['5,4,5','5,5,5','2,4,5','2,5,5'],edits:[],reset:true,step:1});
      return {workerMs:r.duration,changedBricks:r.bricks.length};
    }finally{await w.close();}
  });
  await time(`Cut / ${name}`,async()=>{
    const w=worker('cutWorker.js');try {
      const r=await w.send({state:source.serialize(),bricks:name==='fresh'?bricks:pulled.bricks,points:[[-2,-.4],[2,-.4]],eye,planeZ,symmetry:false});
      return {workerMs:r.duration,valid:r.valid};
    }finally{await w.close();}
  });
  await time(`Paint / ${name} CPU stroke`,()=>{
    const v=ClayVolume.fromState(source.serialize());
    const changes=new Map();paintSegment(v,new THREE.Vector3(.5,0,.6),new THREE.Vector3(.6,.1,.6),new THREE.Vector3(0,0,1),.12,new THREE.Color('#ff3355'),changes);
    return {changedNodes:changes.size};
  });
}
for(const {mesh}of volume.bricks.values())mesh.geometry.dispose();material.dispose();
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));
