// Immutable strokes share a spatial index across all mesh samples. Weak keys
// release it with the stroke when reset/history no longer retain that stroke.
const strokeIndexes = new WeakMap();
function strokeIndex(stroke) {
  let root = strokeIndexes.get(stroke);
  if (root) return root;
  const segments = [];
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    const d = b.map((v, axis) => v - a[axis]);
    segments.push({ a, b, d, len2: d[0]*d[0]+d[1]*d[1]+d[2]*d[2],
      radius: stroke.radii[i - 1], dr: stroke.radii[i] - stroke.radii[i - 1], first: i === 1,
      low: a.map((v, axis) => Math.min(v, b[axis])),
      high: a.map((v, axis) => Math.max(v, b[axis])),
      maxRadius: Math.max(stroke.radii[i - 1], stroke.radii[i]) });
  }
  const build = items => {
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    let radius = 0;
    for (const s of items) {
      for (let axis=0;axis<3;axis++) {low[axis]=Math.min(low[axis],s.low[axis]);high[axis]=Math.max(high[axis],s.high[axis]);}
      radius = Math.max(radius,s.maxRadius);
    }
    const node = {low,high,radius};
    if (items.length <= 6) {node.segments=items;return node;}
    const spans = high.map((v, axis) => v - low[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    items.sort((a,b)=>(a.low[axis]+a.high[axis])-(b.low[axis]+b.high[axis]));
    const mid = items.length >> 1;
    node.left=build(items.slice(0,mid));node.right=build(items.slice(mid));
    return node;
  };
  root = build(segments); strokeIndexes.set(stroke,root); return root;
}
function lowerBound(node,x,y,z) {
  const dx=Math.max(node.low[0]-x,0,x-node.high[0]);
  const dy=Math.max(node.low[1]-y,0,y-node.high[1]);
  const dz=Math.max(node.low[2]-z,0,z-node.high[2]);
  return Math.sqrt(dx*dx+dy*dy+dz*dz)-node.radius;
}
function sampleIndex(node,x,y,z,result) {
  if(lowerBound(node,x,y,z)>=result)return result;
  if(!node.segments) {
    // Visit nearer bounds first, making the second branch easier to reject.
    const left=lowerBound(node.left,x,y,z),right=lowerBound(node.right,x,y,z);
    if(left<right) {result=sampleIndex(node.left,x,y,z,result);return sampleIndex(node.right,x,y,z,result);}
    result=sampleIndex(node.right,x,y,z,result);return sampleIndex(node.left,x,y,z,result);
  }
  for(const s of node.segments) {
    const reach=s.maxRadius+Math.max(0,result);
    if(x<s.low[0]-reach || x>s.high[0]+reach || y<s.low[1]-reach || y>s.high[1]+reach || z<s.low[2]-reach || z>s.high[2]+reach)continue;
    const {a,b,d,len2,radius,dr}=s;
    const qx=x-a[0],qy=y-a[1],qz=z-a[2],dot=qx*d[0]+qy*d[1]+qz*d[2];
    if(len2<=dr*dr+1e-12) {
      result=Math.min(result,Math.hypot(qx,qy,qz)-radius,Math.hypot(x-b[0],y-b[1],z-b[2])-radius-dr);
      continue;
    }
    const perpendicular=Math.max(0,qx*qx+qy*qy+qz*qz-dot*dot/len2);
    const t=Math.max(0,Math.min(1,(dot+dr*Math.sqrt(perpendicular/(1-dr*dr/len2)))/len2));
    let segment=Math.hypot(qx-t*d[0],qy-t*d[1],qz-t*d[2])-radius-dr*t;
    if(s.first)segment=Math.max(segment,-dot/Math.sqrt(len2));
    result=Math.min(result,segment);
  }
  return result;
}

// Union of tapered swept segments. Radius decreases by distance along the path.
export function extrusionDistance(x,y,z,stroke,ceiling=Infinity) {
  const index=strokeIndex(stroke);
  const result=sampleIndex(index,x,y,z,ceiling);
  return stroke.symmetry ? sampleIndex(index,-x,y,z,result) : result;
}

export function taperedStroke(points,radius,symmetry=false,simplify=true) {
  // Remove nearly collinear samples so a straight stroke stays cheap to mesh.
  points=points.map(p=>[...p]);
  for(let i=1;simplify && i<points.length-1;) {
    const a=points[i-1],b=points[i],c=points[i+1];
    const d=c.map((v,j)=>v-a[j]),len=d.reduce((s,v)=>s+v*v,0);
    const t=Math.max(0,Math.min(1,b.reduce((s,v,j)=>s+(v-a[j])*d[j],0)/(len||1)));
    const error=Math.hypot(...b.map((v,j)=>v-a[j]-t*d[j]));
    if(error<Math.min(.0025,radius*.015)) points.splice(i,1); else i++;
  }
  const lengths=[0];
  for(let i=1;i<points.length;i++) lengths.push(lengths[i-1]+Math.hypot(...points[i].map((v,j)=>v-points[i-1][j])));
  const total=lengths.at(-1)||1;
  return {points:points.map(p=>[...p]),radii:lengths.map(d=>radius*(1-.82*d/total)),symmetry};
}

export function blendExtrusion(surface, extrusion, radius) {
  const k=Math.min(.035,radius*.15);
  const h=Math.max(k-Math.abs(surface-extrusion),0)/k;
  return Math.min(surface,extrusion)-h*h*k*.25;
}
