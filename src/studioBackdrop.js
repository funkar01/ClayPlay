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
    this.tone=backdrop.tone;
    this.stage.dataset.studioBackdrop=backdrop.tone;
    this.stage.style.setProperty('--studio-background',backdrop.colour);
  }
}
