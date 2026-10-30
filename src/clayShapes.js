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
  pumpkin: { label: 'Pumpkin eyes', description: 'Large rounded triangles', points: [[-.31,-.2],[.29,-.2],[.06,.26],[-.05,.26]] },
  vampire: { label: 'Vampire eyes', description: 'Dramatic sweeping brows', points: [[-.3,.13],[.32,.22],[.23,-.14],[-.12,-.18],[-.3,-.03]] },
  witch: { label: 'Witch eyes', description: 'Lifted mischievous corners', points: [[-.3,-.01],[-.16,.17],[.33,.24],[.25,-.08],[0,-.19]] },
  frankie: { label: 'Monster eyes', description: 'Broad heavy-lidded windows', width: .32, height: .23, box: true },
  werewolf: { label: 'Werewolf eyes', description: 'Wide prowling eyes · raised outer corners', points: [[-.31,.08],[-.1,.16],[.32,.2],[.25,-.13],[0,-.19],[-.25,-.12]] },
  skull: { label: 'Skull sockets', description: 'Large rounded bone sockets', width: .3, height: .28 },
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

// Retired starters remain readable in saved masks, but leave the pickers.
Object.defineProperties(EYE_SHAPES, {
  mummy: {value:{label:'Mummy eyes',width:.31,height:.23}},
  cat: {value:{label:'Black cat eyes',points:EYE_SHAPES.almond.points.map(([x,y])=>[x*1.12,y*1.18])}},
});

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
  ...Object.fromEntries(['pumpkin','vampire','witch','frankie','werewolf','skull'].map(key => [key, halloweenMask(key)])),
  full: { label: 'Full-face mask', icon: 'M5 4q7-4 14 0v8q0 7-7 10-7-3-7-10ZM7 9h3m4 0h3M10 16h4', distance: (x, y, z, eyes) => maskDistance(x, y, z, 'full', eyes) },
  half: { label: 'Half-face mask', icon: 'M3 7q9-5 18 0v5l-5 4-4-3-4 3-5-4ZM6 10h3m6 0h3', distance: (x, y, z, eyes) => maskDistance(x, y, z, 'half', eyes) },
  animal: { label: 'Animal mask', icon: 'm5 8-2-6 7 4h4l7-4-2 6v6l-7 8-7-8ZM7 11h3m4 0h3m-7 6 2 2 2-2', distance: (x, y, z, eyes) => maskDistance(x, y, z, 'animal', eyes) },
};

export const CLAY_SHAPES = MASK_SHAPES;
for(const key of ['mummy','cat'])Object.defineProperty(MASK_SHAPES,key,{value:halloweenMask(key)});

export function maskPreview(key) {
  const shape=MASK_SHAPES[key], colors=shape.palette ?? ['#b98261','#b98261'];
  const details={
    vampire:`<path d="M9 15q3-2 6 0l-1 2h-4Z" style="fill:${colors[1]}"/><path d="m10 14.6.8 1.9.5-2m1.4 0 .5 2 .8-1.9" style="fill:${colors[0]};stroke:none"/>`,
    witch:`<path d="M4.5 7h15M11.7 10l-1 3h2M9.5 16q2.5 1.5 5 0" style="fill:none;stroke:${colors[1]};stroke-width:.6"/>`,
    werewolf:`<ellipse cx="12" cy="15" rx="3.6" ry="2.6" style="fill:${colors[1]}"/><path d="m10.7 13 1.3 1.5 1.3-1.5Z" style="fill:${colors[0]}"/>`,
    skull:`<path d="m12 12-1 2h2ZM9.3 16h5.4m-4-1v2m1.3-2v2m1.3-2v2" style="fill:${colors[1]};stroke:${colors[1]};stroke-width:.45"/>`,
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shape.icon}" style="fill:${colors[0]}"/><svg width="24" height="8" viewBox="0 0 24 8" overflow="hidden"><path d="${shape.icon}" style="fill:${key === 'skull' ? colors[0] : colors[1]}"/></svg><ellipse cx="9.2" cy="10" rx="1.7" ry=".9"/><ellipse cx="14.8" cy="10" rx="1.7" ry=".9"/>${details[key] ?? ''}</svg>`;
}

function halloweenMask(kind) {
  const specs = {
    pumpkin: ['Pumpkin', 'Plump lobes · orange & forest green', '#ed8129', '#355b38', [[0,1.7],[.16,1.65],[.12,1.28],[.68,1.25],[1.05,.92],[1.2,.35],[1.16,-.5],[.8,-1.08],[0,-1.25],[-.8,-1.08],[-1.16,-.5],[-1.2,.35],[-1.05,.92],[-.68,1.25],[-.12,1.28],[-.16,1.65]]],
    vampire: ['Vampire', 'Fangs · widow’s peak · pointed ears', '#e5d7c8', '#40263e', [[0,1.22],[.4,1.4],[.8,1.2],[.92,.65],[1.2,.72],[1.02,.02],[.88,-.35],[.65,-.98],[0,-1.42],[-.65,-.98],[-.88,-.35],[-1.02,.02],[-1.2,.72],[-.92,.65],[-.8,1.2],[-.4,1.4]]],
    witch: ['Witch', 'Pointed hat · hooked nose · arched brows', '#a6bf68', '#50365f', [[0,1.98],[.32,1.69],[.59,1.04],[1.3,.87],[1.3,.71],[.84,.68],[.97,-.2],[.58,-.95],[.2,-1.42],[0,-1.5],[-.2,-1.42],[-.58,-.95],[-.97,-.2],[-.84,.68],[-1.3,.71],[-1.3,.87],[-.59,1.04],[-.32,1.69]]],
    frankie: ['Frankenstein’s monster', 'Broad brow · moss & charcoal', '#91b76b', '#343b38', [[-.82,1.4],[.82,1.4],[1,1.13],[.98,-.45],[1.18,-.48],[1.18,-.72],[.91,-.75],[.7,-1.2],[0,-1.35],[-.7,-1.2],[-.91,-.75],[-1.18,-.72],[-1.18,-.48],[-.98,-.45],[-1,1.13]]],
    werewolf: ['Werewolf', 'Tufted fur · pointed ears · rounded muzzle', '#79513c', '#dfbd86', [[0,1.14],[.28,1.3],[.43,1.1],[.98,1.8],[1.05,1.05],[.94,.7],[1.24,.43],[1.04,.25],[1.23,.02],[1.02,-.12],[1.2,-.4],[.9,-.42],[1.02,-.7],[.71,-.7],[.63,-1.04],[.32,-1.14],[0,-1.3],[-.32,-1.14],[-.63,-1.04],[-.71,-.7],[-1.02,-.7],[-.9,-.42],[-1.2,-.4],[-1.02,-.12],[-1.23,.02],[-1.04,.25],[-1.24,.43],[-.94,.7],[-1.05,1.05],[-.98,1.8],[-.43,1.1],[-.28,1.3]]],
    skull: ['Skull', 'Bone sockets · nasal hollow · outlined teeth', '#e8ddc7', '#494044', [[0,1.4],[.6,1.3],[.95,.98],[1.06,.48],[1.02,-.16],[.83,-.42],[.59,-.48],[.65,-.86],[.54,-1.25],[0,-1.36],[-.54,-1.25],[-.65,-.86],[-.59,-.48],[-.83,-.42],[-1.02,-.16],[-1.06,.48],[-.95,.98],[-.6,1.3]]],
    mummy: ['Mummy', 'Rounded wraps · linen & warm sand', '#e7dcc4', '#b09b7b', null],
    cat: ['Black cat', 'Pointed ears · charcoal & warm gold', '#30323c', '#dca951', [[0,1.02],[.5,1.12],[1,1.7],[1.08,.8],[1.12,.05],[.85,-.75],[0,-1.18],[-.85,-.75],[-1.12,.05],[-1.08,.8],[-1,1.7],[-.5,1.12]]],
  };
  const [label,description,base,accent,points] = specs[kind];
  const iconPoints = points ?? Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/16)*1.04,Math.sin(i*Math.PI/16)*1.4]);
  return {label,description,palette:[base,accent], eyeShape:kind,
    icon:iconPoints.map(([x,y],i)=>`${i?'L':'M'}${12+x*5.8} ${12-y*5.8}`).join('')+'Z',
    accentAt(x,y) {
      const a=Math.abs(x);
      if(kind==='pumpkin')return y>1.22 || Math.abs(a-.57)<.035;
      if(kind==='vampire') {
        const hair=y>1.04-.43*Math.exp(-((x/.25)**2));
        const brow=a>.18 && a<.77 && Math.abs(y-(.68+.12*a))<.045;
        const mouth=(x/.52)**2+((y+.69)/.22)**2<1;
        const fang=a>.25 && a<.41 && y<-.52 && y>-.88+(Math.abs(a-.33)/.08)*.3;
        return hair || brow || (mouth && !fang) || (a>.78 && y<-.25);
      }
      if(kind==='witch') {
        const hat=y>.71;
        const buckle=a<.16 && y>1.02 && y<1.2;
        const brow=a>.18 && a<.77 && Math.abs(y-(.68+.13*Math.sin((a-.18)*5)))<.045;
        const smile=a<.43 && Math.abs(y-(-.79+.22*(a/.43)**2))<.035;
        const wart=((a-.26)/.06)**2+((y+.29)/.06)**2<1;
        return (hat && !buckle) || brow || smile || wart;
      }
      if(kind==='frankie')return y>1.02+.06*Math.cos(x*23) || (a>.98 && y<-.4);
      if(kind==='werewolf') {
        const muzzle=(x/.64)**2+((y+.52)/.5)**2<1;
        const nose=a<.22 && y<-.22 && y>-.44+a*.6;
        return (muzzle && !nose) || (y>1.04 && a>.7) || (a>.65 && a<.95 && y<.05 && y>-.33);
      }
      if(kind==='skull') {
        const nose=y<-.12 && y>-.48 && a<(.48+y)*.52;
        const teeth=a<.5 && y<-.72 && y>-1.13 && (Math.abs(y+.91)<.025 || Math.abs(Math.sin(x*24))<.24);
        const cheeks=a>.58 && a<.87 && y<-.24 && y>-.43;
        return nose || teeth || cheeks;
      }
      if(kind==='mummy')return Math.abs(Math.sin((y+x*.24)*12))<.23;
      return (y>.95 && a>.6) || ((a/.55)**2+((y+.55)/.38)**2<1);
    },
    distance(x,y,z,eyes=kind) {
      let outline=points ? silhouetteDistance(x,y,points) : (Math.hypot(x/1.04,y/1.4)-1)*1.04;
      if(kind==='pumpkin')outline-=.035*Math.cos(x*11);
      // Small rounded relief follows the curved hollow shell on both sides.
      let relief=kind==='pumpkin'?.012*(Math.cos(x*11)-1):kind==='mummy'?.009*(Math.cos((y+Math.abs(x)*.24)*24)-1):0;
      if(kind==='witch')relief=.028*Math.exp(-((x/.14)**2+((y+.26)/.34)**2))*(1-Math.exp(-((y/.12)**2)));
      if(kind==='werewolf')relief=.025*Math.exp(-((x/.55)**2+((y+.5)/.4)**2));
      return facialShell(x,y,z-relief,Math.max(outline,-eyeDistance(x,y,eyes)));
    },
  };
}

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

