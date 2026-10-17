export function palmHand(closed=false,dx=0,dy=0) {
  const p=Array.from({length:21},()=>({x:.5+dx,y:.5+dy,z:0}));
  p[0]={x:.5+dx,y:.65+dy,z:0};
  for(const [base,joint,tip,x]of [[5,6,8,.42],[9,10,12,.48],[13,14,16,.54],[17,18,20,.60]]) {
    p[base]={x:x+dx,y:.50+dy,z:0};
    p[joint]={x:x+dx,y:.40+dy,z:0};
    p[tip]={x:x+dx,y:(closed?.56:.28)+dy,z:0};
    p[tip-1]={x:x+dx,y:(closed?.50:.34)+dy,z:0};
  }
  p[4]={x:.36+dx,y:.45+dy,z:0};return p;
}
