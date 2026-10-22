// Shared by the worker and the small, bounded updates used while painting.
export function fillPaintTexture(data,{min,size,spacing,lo=[0,0,0],hi=size.map(v=>v-1)},sample) {
  for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++) {
    const color=sample(min[0]+x*spacing,min[1]+y*spacing,min[2]+z*spacing);
    const index=((z*size[1]+y)*size[0]+x)*4;
    for(let c=0;c<4;c++)data[index+c]=Math.round(Math.min(1,Math.max(0,color[c]))*255);
  }
  return data;
}
