// Union of tapered swept segments. Radius decreases by distance along the path.
export function referenceExtrusionDistance(x,y,z,stroke,ceiling=Infinity) {
  const distance = px => {
    let result = ceiling;
    const {points,radii} = stroke;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1], b=points[i];
      const reach=Math.max(radii[i-1],radii[i])+Math.max(0,result);
      if(px<Math.min(a[0],b[0])-reach || px>Math.max(a[0],b[0])+reach
        || y<Math.min(a[1],b[1])-reach || y>Math.max(a[1],b[1])+reach
        || z<Math.min(a[2],b[2])-reach || z>Math.max(a[2],b[2])+reach) continue;
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
      const len2=dx*dx+dy*dy+dz*dz;
      const qx=px-a[0],qy=y-a[1],qz=z-a[2];
      const dot=qx*dx+qy*dy+qz*dz, dr=radii[i]-radii[i-1];
      // Closest point on a tapered sweep is shifted along the axis. Using the
      // ordinary capsule projection creates ridges where tapered pieces join.
      if(len2<=dr*dr+1e-12) {
        result=Math.min(result,Math.hypot(qx,qy,qz)-radii[i-1],Math.hypot(px-b[0],y-b[1],z-b[2])-radii[i]);
        continue;
      }
      const perpendicular=Math.max(0,qx*qx+qy*qy+qz*qz-dot*dot/len2);
      const t=Math.max(0,Math.min(1,(dot+dr*Math.sqrt(perpendicular/(1-dr*dr/len2)))/len2));
      const radius=radii[i-1]+(radii[i]-radii[i-1])*t;
      let segment=Math.hypot(px-a[0]-t*dx,y-a[1]-t*dy,z-a[2]-t*dz)-radius;
      // Start flush with the attachment plane instead of adding a ball at the root.
      if(i===1) segment=Math.max(segment,-dot/Math.sqrt(len2));
      result=Math.min(result,segment);
    }
    return result;
  };
  return Math.min(distance(x),stroke.symmetry ? distance(-x) : Infinity);
}
