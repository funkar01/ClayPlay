import { ClayVolume } from './clayVolume.js';
import { createPaintSampler } from './paintSampling.js';
import { fillPaintTexture } from './paintTextureData.js';

self.onmessage=({data})=>{
  const {id,state,min,size,spacing}=data;
  try {
    const started=performance.now(),volume=ClayVolume.fromState(state),sample=createPaintSampler(volume);
    const pixels=fillPaintTexture(new Uint8Array(size.reduce((a,b)=>a*b,1)*4),{min,size,spacing},sample);
    self.postMessage({id,pixels,durationMs:performance.now()-started},[pixels.buffer]);
  } catch(error) {self.postMessage({id,error:error.message});}
};
