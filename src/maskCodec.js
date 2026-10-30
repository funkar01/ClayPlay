const MAX_BYTES=96*1024*1024;
function base64(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=24576)text+=btoa(String.fromCharCode(...bytes.subarray(i,i+24576)));return text;
}
function bytes(text) {
  if(typeof text!=='string'||text.length>MAX_BYTES*1.4)throw new Error('Invalid saved mask data.');
  const binary=atob(text),out=new Uint8Array(binary.length);for(let i=0;i<out.length;i++)out[i]=binary.charCodeAt(i);return out;
}
async function read(stream) {
  const reader=stream.getReader(),parts=[];let size=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_BYTES)throw new Error('This mask is too large to save online.');parts.push(value);}}
  finally{await reader.cancel();}
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
export async function packMask(record) {
  const text=JSON.stringify(record,(_key,value)=>value instanceof Float32Array?{float32:base64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))}:value);
  if(new Blob([text]).size>MAX_BYTES)throw new Error('This mask is too large to save online.');
  const data=base64(await read(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))));
  if(data.length>16*1024*1024)throw new Error('This mask is too large to save online.');
  return {version:1,codec:'gzip',data};
}
export async function unpackMask(payload) {
  if(payload?.version!==1 || payload.codec!=='gzip')throw new Error('This mask needs a newer version of ClayPlay.');
  const content=await read(new Blob([bytes(payload.data)]).stream().pipeThrough(new DecompressionStream('gzip')));
  return JSON.parse(new TextDecoder().decode(content),(_key,value)=>{
    if(value && typeof value==='object' && Object.hasOwn(value,'float32')) {
      const buffer=bytes(value.float32);if(buffer.byteLength%4)throw new Error('Invalid saved surface.');return new Float32Array(buffer.buffer);
    }return value;
  });
}
let worker,sequence=0;const jobs=new Map();
export function maskCodec(operation,value) {
  if(typeof Worker==='undefined')return operation==='pack'?packMask(value):unpackMask(value);
  if(!worker) {
    worker=new Worker(new URL('./maskSaveWorker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;clearTimeout(job.timer);jobs.delete(data.id);
      data.error?job.reject(new Error(data.error)):job.resolve(data.result);};
    worker.onerror=()=>{for(const job of jobs.values()){clearTimeout(job.timer);job.reject(new Error('Could not prepare your mask. Try Save again.'));}jobs.clear();worker.terminate();worker=null;};
  }
  return new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{jobs.delete(id);reject(new Error('Preparing the mask took too long. Please retry.'));},60000);
    jobs.set(id,{resolve,reject,timer});
    try{worker.postMessage({id,operation,value});}catch(error){clearTimeout(timer);jobs.delete(id);reject(error);}
  });
}
