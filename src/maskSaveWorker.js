import {packMask,unpackMask} from './maskCodec.js';
self.onmessage=async({data:{id,operation,value}})=>{
  try{self.postMessage({id,result:await(operation==='pack'?packMask(value):unpackMask(value))});}
  catch(error){self.postMessage({id,error:error.message});}
};
