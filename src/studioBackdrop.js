import { STUDIO_THEMES, DEFAULT_STUDIO_THEME } from './studioThemes.js';
import * as THREE from 'three';

const backdrops=[
  {tone:'light',colour:'#eadfd2'},
  {tone:'dark',colour:'#28323b'},
];
// Three.js material colors are already linear, ready for relative luminance.
const luminance=color=>.2126*color.r+.7152*color.g+.0722*color.b;

const contrast=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);

export function studioBackdropFor(maskColour, choices=backdrops) {
  const levels=choices.map(({colour})=>luminance(new THREE.Color(colour)));
  const level=luminance(maskColour);
  return choices[contrast(level,levels[1])>contrast(level,levels[0])?1:0];
}

export class StudioBackdrop {
  constructor({scene,stage}) {
    this.stage=stage;
    this.background=new THREE.Color(backdrops[0].colour);
    this.lastColour=new THREE.Color();
    scene.background=this.background;
    const doc=stage.ownerDocument;
    if(doc) {
      this.glowCanvas=doc.createElement('canvas');this.glowCanvas.width=512;this.glowCanvas.height=384;
      const texture=new THREE.CanvasTexture(this.glowCanvas);texture.colorSpace=THREE.SRGBColorSpace;
      this.glow=new THREE.Mesh(new THREE.PlaneGeometry(18,13.5),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
      this.glow.name='StudioAmbientGlow';this.glow.position.z=-3.5;this.glow.renderOrder=-10;this.glow.raycast=()=>{};scene.add(this.glow);
      this.platform=new THREE.Group();this.platform.name='StudioPresentationStage';
      const points=Array.from({length:96},(_,i)=>{const a=i/96*Math.PI*2;return new THREE.Vector3(Math.cos(a)*1.65,Math.sin(a)*.16,0);});
      this.rim=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({transparent:true,opacity:.14,depthWrite:false,toneMapped:false}));
      this.floor=new THREE.Mesh(new THREE.CircleGeometry(1,64),new THREE.MeshBasicMaterial({transparent:true,opacity:.025,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
      this.floor.scale.set(1.65,.16,1);this.platform.add(this.floor,this.rim);this.platform.raycast=()=>{};scene.add(this.platform);
    }
  }
  present(mask,{visible=true,painting=false}={}) {
    if(!this.glow)return;
    this.glow.visible=visible;this.platform.visible=visible;
    this.glow.material.opacity=painting ? .35 : 1;
    this.rim.material.opacity=painting ? .06 : .14;this.floor.material.opacity=painting ? .01 : .025;
    this.platform.position.copy(mask.position);this.platform.position.y-=1.58*mask.scale.y;this.platform.position.z-=.15;
    this.platform.scale.set(mask.scale.x,mask.scale.y,1);
  }
  update(maskColour) {
    const themeId=this.stage.ownerDocument?.documentElement?.dataset.studioTheme ?? DEFAULT_STUDIO_THEME;
    if(this.initialized && this.lastColour.equals(maskColour) && this.themeId===themeId)return;
    this.themeId=themeId;
    this.initialized=true;this.lastColour.copy(maskColour);
    const theme=STUDIO_THEMES.find(t=>t.id===themeId) ?? STUDIO_THEMES.find(t=>t.id===DEFAULT_STUDIO_THEME);
    const dark={clay:'#28323b',lilac:'#30213e',lagoon:'#163a37',midnight:'#211c30'};
    const backdrop=studioBackdropFor(maskColour,[{tone:'light',colour:theme.backdropLight ?? (theme.dark?'#e8def0':theme.tokens[1])},{tone:'dark',colour:theme.backdropDark ?? dark[theme.id] ?? theme.tokens[1]}]);
    // Preserve this Color's identity: camera mode stores it while the live
    // video is visible and restores it when returning to the playground.
    this.background.set(backdrop.colour);
    if(this.glow) {
      const ctx=this.glowCanvas.getContext('2d');ctx.clearRect(0,0,512,384);
      for(const [x,y,radius,color,alpha] of [[205,190,190,theme.tokens[8],.24],[330,225,165,theme.tokens[10],.13]]) {
        const rgb=new THREE.Color(color);const gradient=ctx.createRadialGradient(x,y,0,x,y,radius);
        const srgb=rgb.clone().convertLinearToSRGB();const channels=[srgb.r,srgb.g,srgb.b].map(v=>Math.round(v*255)).join(',');
        gradient.addColorStop(0,`rgba(${channels},${alpha})`);gradient.addColorStop(1,`rgba(${channels},0)`);ctx.fillStyle=gradient;ctx.fillRect(0,0,512,384);
      }
      this.glow.material.map.needsUpdate=true;this.rim.material.color.set(theme.tokens[8]);this.floor.material.color.set(theme.tokens[8]);
    }
    this.tone=backdrop.tone;
    this.stage.dataset.studioBackdrop=backdrop.tone;
    this.stage.style.setProperty('--studio-background',backdrop.colour);
  }
}
