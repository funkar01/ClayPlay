import { MASK_SHAPES, EYE_SHAPES, faceSurface } from './clayShapes.js';
import { acceptsTutorialPull } from './tutorialMission.js';

const shapes = ['animal', 'full', 'half', 'armor', 'cowl', 'wings', 'helmet'].filter(key => MASK_SHAPES[key]);
const eyes = Object.keys(EYE_SHAPES);
const challenges = {
  horns: { id:'horns', tool:'pinch', title:'Using Pull for two little horns.', copy:'Pinch the glowing spot, pull up and out, then open your fingers.', target:[-.43,1.08,.4], motion:'up' },
  curve: { id:'curve', tool:'pinch', title:'Using Pull for a quirky curve.', copy:'Pinch the glowing spot, pull outward, then open your fingers.', target:[-.64,-.16,.5], motion:'side' },
  spikes: { id:'spikes', tool:'extrude', title:'Using Extrude for a pair of spikes.', copy:'Pinch the glowing spot, trace up and out, then open your fingers.', target:[-.88,.7,.4], motion:'up' },
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
const colours=['#df7e87','#719fb2','#9b88bd','#79a572','#e4b44d','#d98055'];

// Guides diverge from the midline on either side, including vertical horn strokes.
export function outwardGuideTarget(mission) {
  const [x,y,z]=mission.target;
  return [x+(x<0 ? -.5 : .5),y+(mission.motion==='up' ? .5 : 0),z];
}

// Fit every hint to solid clay, including masks with open chins/crowns and larger eyes.
function surfaceTarget(shape, eye, preferred) {
  let best=null,score=Infinity;
  for(let ix=-30;ix<=30;ix++)for(let iy=-25;iy<=38;iy++) {
    const x=ix*.04,y=iy*.04,z=faceSurface(x,y)+.055;
    if(MASK_SHAPES[shape].distance(x,y,z,eye)>-.015)continue;
    const distance=(x-preferred[0])**2+(y-preferred[1])**2;
    if(distance<score){score=distance;best=[x,y,z];}
  }
  if(!best)throw new Error('This mask has no tutorial surface.');
  return best;
}
export function createTutorialRecipe(run=0) {
  run=Number.isSafeInteger(run)&&run>=0 ? run : 0;
  const shape=shapes[run%shapes.length],eye=eyes[run%eyes.length];
  const steps=combinations[run%combinations.length].map(key=>{
    const lesson=challenges[key];
    return {...lesson,target:surfaceTarget(shape,eye,lesson.target)};
  });
  return {run,shape,eyes:eye,shapeLabel:MASK_SHAPES[shape].label,eyeLabel:EYE_SHAPES[eye].label,colour:colours[run%colours.length],steps};
}
export function acceptsTutorialAction(mission,tool,data) {
  if(!mission || mission.tool!==tool)return false;
  if(tool==='pinch')return acceptsTutorialPull(mission,data);
  if(tool==='erase')return data?.changed===true;
  const point=tool==='extrude' ? data?.points?.[0] : data?.point;
  if(!point || Math.hypot(point[0]-mission.target[0],point[1]-mission.target[1])>.45)return false;
  if(tool==='paint')return true;
  if(tool==='extrude') {
    const end=data.points.at(-1);
    return data.points.length>1 && Math.hypot(...end.map((v,i)=>v-point[i]))>.09;
  }
  return false;
}
