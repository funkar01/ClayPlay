// Hollow curved mask shells facing the camera along +Z.
const SHELL_HALF_THICKNESS = 0.12;
const RIM_RADIUS = 0.045;

// All silhouettes sit on the same sculpted facial form. The back follows the
// front, leaving a hollow interior rather than filling the mask into a block.
export function faceSurface(x, y) {
  const bump = (cx, cy, sx, sy) => Math.exp(-(((x-cx)/sx)**2 + ((y-cy)/sy)**2));
  const wrap = 0.43 - 0.40*x*x - 0.14*(y/1.4)**2;
  const forehead = 0.13*bump(0, .88, .72, .52);
  const bridge = 0.17*bump(0, .28, .18, .52);
  const nose = 0.25*bump(0, -.08, .25, .23);
  const cheeks = 0.14*(bump(.64, -.16, .32, .4) + bump(-.64, -.16, .32, .4));
  const muzzle = 0.065*bump(0, -.57, .46, .22);
  const chin = 0.15*bump(0, -1.08, .4, .28);
  return wrap + forehead + bridge + nose + cheeks + muzzle + chin;
}

function facialShell(x, y, z, footprint) {
  // Rounded intersection closes the front and back at every outer and eye rim.
  const edge = footprint + RIM_RADIUS;
  const depth = Math.abs(z-faceSurface(x,y)) - SHELL_HALF_THICKNESS + RIM_RADIUS;
  return Math.min(Math.max(edge,depth),0) + Math.hypot(Math.max(edge,0),Math.max(depth,0)) - RIM_RADIUS;
}

export const EYE_SHAPES = {
  oval: { label: 'Classic oval', description: 'Soft and balanced', width: .27, height: .19 },
  round: { label: 'Round goggles', description: 'Curious and playful', width: .25, height: .25 },
  slanted: { label: 'Hero slant', description: 'Lifted outer corners', points: [[-.28,-.02],[.29,.15],[.24,-.07],[.08,-.16],[-.1,-.13]] },
  almond: { label: 'Swept almond', description: 'Pointed and flowing', points: [[-.29,-.04],[-.14,.1],[.12,.17],[.3,.16],[.18,-.09],[0,-.15],[-.18,-.1]] },
  angular: { label: 'Angular', description: 'Bold geometric edges', points: [[-.28,.04],[.28,.17],[.2,-.14],[-.12,-.14]] },
  visor: { label: 'Wide goggles', description: 'Broad rounded windows', width: .31, height: .22, box: true },
};

// Sample two quadratic arcs so the almond has a smooth rim in the clay mesh.
EYE_SHAPES.almond.points = [];
for (const [a,b,c] of [
  [[-.29,-.04],[-.06,.24],[.3,.16]],
  [[.3,.16],[.12,-.3],[-.29,-.04]],
]) for (let i = 0; i < 16; i++) {
  const t = i/16, s = 1-t;
  EYE_SHAPES.almond.points.push([s*s*a[0]+2*s*t*b[0]+t*t*c[0],s*s*a[1]+2*s*t*b[1]+t*t*c[1]]);
}

export function eyeDistance(x, y, kind = 'oval') {
  const shape = EYE_SHAPES[kind] ?? EYE_SHAPES.oval;
  const u = Math.abs(x)-.46, v = y-.35;
  if (shape.points) return silhouetteDistance(u,v,shape.points);
  if (shape.box) {
    const radius = .1;
    const a = Math.abs(u)-shape.width+radius, b = Math.abs(v)-shape.height+radius;
    return Math.min(Math.max(a,b),0)+Math.hypot(Math.max(a,0),Math.max(b,0))-radius;
  }
  return (Math.hypot(u/shape.width,v/shape.height)-1)*Math.min(shape.width,shape.height);
}

export function eyePreview(kind) {
  const shape = EYE_SHAPES[kind];
  let right;
  if (shape.points) right = `<path d="${shape.points.map(([x,y],i) => `${i ? 'L' : 'M'}${79.44+x*64} ${25-y*64}`).join('')}Z"/>`;
  else right = `<rect x="${79.44-shape.width*64}" y="${25-shape.height*64}" width="${shape.width*128}" height="${shape.height*128}" rx="${shape.box ? 6.4 : shape.width*64}" ry="${shape.box ? 6.4 : shape.height*64}"/>`;
  return `<svg viewBox="0 0 100 50" aria-hidden="true">${right}<g transform="translate(100 0) scale(-1 1)">${right}</g></svg>`;
}

function maskDistance(x, y, z, kind, eyes) {
  const width = kind === 'animal' ? 1.12 : 1.04;
  const height = kind === 'half' ? 0.66 : 1.4;
  const centerY = kind === 'half' ? 0.28 : 0;
  let outline = (Math.hypot(x / width, (y - centerY) / height) - 1) * Math.min(width, height);
  if (kind === 'animal') {
    for (const side of [-1, 1]) {
      const ear = (Math.hypot((x - side * 0.77) / 0.27, (y - 1.2) / 0.57) - 1) * 0.27;
      outline = Math.min(outline, ear);
    }
  }
  const eye = eyeDistance(x,y,eyes);
  return facialShell(x,y,z,Math.max(outline,-eye));
}

export const MASK_SHAPES = {
  full: { label: 'Full-face mask', icon: 'M5 4q7-4 14 0v8q0 7-7 10-7-3-7-10ZM7 9h3m4 0h3M10 16h4', distance: (x, y, z, eyes) => maskDistance(x, y, z, 'full', eyes) },
  half: { label: 'Half-face mask', icon: 'M3 7q9-5 18 0v5l-5 4-4-3-4 3-5-4ZM6 10h3m6 0h3', distance: (x, y, z, eyes) => maskDistance(x, y, z, 'half', eyes) },
  animal: { label: 'Animal mask', icon: 'm5 8-2-6 7 4h4l7-4-2 6v6l-7 8-7-8ZM7 11h3m4 0h3m-7 6 2 2 2-2', distance: (x, y, z, eyes) => maskDistance(x, y, z, 'animal', eyes) },
};

export const CLAY_SHAPES = MASK_SHAPES;

// Signed distance to a closed silhouette, shared by the thumbnail and clay shell.
function silhouetteDistance(x, y, points) {
  let inside = false, nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -nearest : nearest;
}

const silhouettes = {
  armor: ['Armored mask', 'Angular cheeks · tapered chin', [[0,1.4],[.6,1.25],[.94,.85],[.98,-.35],[.7,-1.05],[.36,-1.38],[-.36,-1.38],[-.7,-1.05],[-.98,-.35],[-.94,.85],[-.6,1.25]]],
  cowl: ['Pointed cowl', 'Tall ears · open lower face', [[-1,1.65],[-.5,1.15],[0,1.3],[.5,1.15],[1,1.65],[.98,-.35],[.62,-.5],[.3,-.42],[0,-.62],[-.3,-.42],[-.62,-.5],[-.98,-.35]]],
  wings: ['Winged mask', 'Sweeping tips · open chin', [[-1.2,1.55],[-.95,.95],[-.55,.68],[0,.1],[.55,.68],[.95,.95],[1.2,1.55],[1.1,.1],[.75,-.7],[.62,-.35],[.15,-.45],[0,-.1],[-.15,-.45],[-.62,-.35],[-.75,-.7],[-1.1,.1]]],
  helmet: ['Crested helmet', 'Rounded crown · open face', [[0,1.4],[.65,1.25],[.98,.8],[1,-1.15],[.55,-1.45],[.55,.05],[.28,.5],[0,.2],[-.28,.5],[-.55,.05],[-.55,-1.45],[-1,-1.15],[-.98,.8],[-.65,1.25]]],
};
MASK_SHAPES.full.description = 'A rounded canvas for any character';
MASK_SHAPES.half.description = 'Eye mask · open lower face';
MASK_SHAPES.animal.description = 'Soft ears · rounded face';
for (const [key, [label, description, points]] of Object.entries(silhouettes)) {
  MASK_SHAPES[key] = {
    label, description,
    icon: points.map(([x,y], i) => `${i ? 'L' : 'M'}${12+x*6} ${12-y*6}`).join('') + 'Z',
    distance(x, y, z, eyes) {
      const eye = eyeDistance(x,y,eyes);
      return facialShell(x,y,z,Math.max(silhouetteDistance(x,y,points),-eye));
    },
  };
}

