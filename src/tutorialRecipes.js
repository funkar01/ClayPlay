import { MASK_SHAPES, EYE_SHAPES, faceSurface } from './clayShapes.js';
import { acceptsTutorialPull } from './tutorialMission.js';

const shapes = ['animal', 'full', 'half', 'armor', 'cowl', 'wings', 'helmet'].filter(key => MASK_SHAPES[key]);
const eyes = Object.keys(EYE_SHAPES);
const challenges = {
  horns: { id:'horns', tool:'pinch', title:'Using Pull for two little horns.', copy:'Pinch the glowing spot, pull up and out, then open your fingers.', target:[.43,1.08,.4], motion:'up' },
  curve: { id:'curve', tool:'pinch', title:'Using Pull for a quirky curve.', copy:'Pinch the glowing spot, pull outward, then open your fingers.', target:[.64,-.16,.5], motion:'side' },
  spikes: { id:'spikes', tool:'extrude', title:'Using Extrude for a pair of spikes.', copy:'Pinch the glowing spot, trace up and out, then open your fingers.', target:[.88,.7,.4], motion:'up' },
  notch: { id:'notch', tool:'erase', title:'Using Erase for a cheek notch.', copy:'Pinch the glowing edge, brush outward, then open your fingers.', target:[.88,-.16,.3], motion:'side' },
  colour: { id:'colour', tool:'paint', title:'Using Paint for a splash of colour.', copy:'Pinch the glowing patch, brush outward, then open your fingers.', target:[.25,.85,.5], motion:'side' },
};
// Every run teaches each available tool once; vary the order and Pull challenge.
// Leave erasing until last so it cannot remove a later lesson's starting patch.
const combinations = [
  ['spikes','colour','curve','notch'],
  ['horns','colour','spikes','notch'],
  ['curve','spikes','colour','notch'],
  ['colour','curve','spikes','notch'],
  ['spikes','curve','colour','notch'],
  ['colour','horns','spikes','notch'],
];
// Alternate cheerful brights, soft pastels, and rich jewel tones between runs.
// Pair light masks with deeper pigments and rich masks with lighter accents.
const palettes=[
  {maskColour:'#e87967',colour:'#49244f'}, // Coral / deep plum
  {maskColour:'#3d67c9',colour:'#fff0c8'}, // Cobalt / vanilla
  {maskColour:'#87cdb1',colour:'#294252'}, // Mint / ink blue
  {maskColour:'#b987d4',colour:'#392044'}, // Orchid / mulberry
  {maskColour:'#e6b946',colour:'#3e3a72'}, // Sunflower / indigo
  {maskColour:'#259a9b',colour:'#302039'}, // Lagoon / blackberry
  {maskColour:'#eba873',colour:'#3c426e'}, // Peach / midnight blue
  {maskColour:'#aa3b6b',colour:'#fbe9b7'}, // Raspberry / buttercream
  {maskColour:'#72b8db',colour:'#42316d'}, // Sky blue / violet
  {maskColour:'#b8ca70',colour:'#354a45'}, // Pistachio / pine
  {maskColour:'#6b458a',colour:'#a8e2cf'}, // Royal plum / seafoam
  {maskColour:'#ef9953',colour:'#422a61'}, // Tangerine / aubergine
];

// Guides diverge from the midline on either side, including vertical horn strokes.
export function outwardGuideTarget(mission) {
  const [x,y,z]=mission.target;
  return [x+(x<0 ? -.5 : .5),y+(mission.motion==='up' ? .5 : 0),z];
}

// Fit every hint to solid clay on the user's right, including open silhouettes
// and larger eyes. Reserve each position so nearby lessons cannot collapse to
// the same patch when a preferred spot falls outside the mask or inside an eye.
function surfaceTarget(shape, eye, preferred, reserved) {
  let best=null,score=Infinity;
  for(let ix=3;ix<=30;ix++)for(let iy=-25;iy<=38;iy++) {
    const x=ix*.04,y=iy*.04,z=faceSurface(x,y)+.055;
    if(MASK_SHAPES[shape].distance(x,y,z,eye)>-.015)continue;
    if(reserved.some(point=>Math.hypot(x-point[0],y-point[1])<.4))continue;
    const distance=(x-preferred[0])**2+(y-preferred[1])**2;
    if(distance<score){score=distance;best=[x,y,z];}
  }
  if(!best)throw new Error('This mask has no tutorial surface.');
  return best;
}
export function createTutorialRecipe(run=0) {
  run=Number.isSafeInteger(run)&&run>=0 ? run : 0;
  const shape=shapes[run%shapes.length],eye=eyes[run%eyes.length];
  const reserved=[];
  const steps=combinations[run%combinations.length].map(key=>{
    const lesson=challenges[key];
    const target=surfaceTarget(shape,eye,lesson.target,reserved);
    reserved.push(target);
    return {...lesson,target};
  });
  return {run,shape,eyes:eye,shapeLabel:MASK_SHAPES[shape].label,eyeLabel:EYE_SHAPES[eye].label,...palettes[run%palettes.length],steps};
}
function paintTouchesTarget(mission,data) {
  const radius=.45+(Number.isFinite(data?.radius)?Math.max(0,Math.min(.5,data.radius)):0);
  const near=(a,b=a,mirror=false)=>{
    if(!a || !b || ![a[0],a[1],b[0],b[1]].every(Number.isFinite))return false;
    const sign=mirror?-1:1,ax=a[0]*sign,dx=(b[0]-a[0])*sign,dy=b[1]-a[1];
    const length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((mission.target[0]-ax)*dx+(mission.target[1]-a[1])*dy)/length)):0;
    return Math.hypot(ax+t*dx-mission.target[0],a[1]+t*dy-mission.target[1])<=radius;
  };
  if(Array.isArray(data?.segments))return data.segments.some(segment=>Array.isArray(segment)
    && (near(segment[0],segment[1]) || (data.symmetry && near(segment[0],segment[1],true))));
  return near(data?.point);
}

export function acceptsTutorialAction(mission,tool,data) {
  if(!mission || mission.tool!==tool)return false;
  if(tool==='pinch')return acceptsTutorialPull(mission,data);
  if(tool==='erase')return data?.changed===true;
  if(tool==='paint')return paintTouchesTarget(mission,data);
  const point=tool==='extrude' ? data?.points?.[0] : data?.point;
  if(!point || Math.hypot(point[0]-mission.target[0],point[1]-mission.target[1])>.45)return false;
  if(tool==='extrude') {
    const end=data.points.at(-1);
    return data.points.length>1 && Math.hypot(...end.map((v,i)=>v-point[i]))>.09;
  }
  return false;
}
