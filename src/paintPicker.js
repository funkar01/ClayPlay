import { CLAY_COLORS } from './clayAppearance.js';

export function hsvToHex(h, s, v) {
  h=((h%360)+360)%360; s=Math.max(0,Math.min(100,s))/100; v=Math.max(0,Math.min(100,v))/100;
  const channel=n=>{
    const k=(n+h/60)%6;
    return Math.round(255*v*(1-s*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function hexToHsv(hex, fallbackHue=0) {
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  const h=d ? ((max===r ? (g-b)/d : max===g ? (b-r)/d+2 : (r-g)/d+4)*60+360)%360 : fallbackHue;
  return [h,max ? d/max*100 : 0,max*100];
}

export class PaintPicker {
  constructor(stage, color, onChange) {
    this.onChange=onChange;
    const root=this.element=document.createElement('section');
    root.className='paint-palette';root.hidden=true;root.setAttribute('aria-label','Paint colors');
    root.innerHTML=`<header class="paint-palette-heading"><strong>Paint color</strong><span>Make it yours</span></header>
      <div class="paint-preview"><span class="paint-preview-chip" aria-hidden="true"></span><div><strong id="paint-color-name"></strong><output class="paint-hex" aria-label="Selected paint color"></output></div></div>
      <fieldset class="paint-basic"><legend>Basic colors</legend><div class="paint-swatches">${CLAY_COLORS.map(([name,hex],i)=>`<button type="button" id="paint-swatch-${i}" data-paint-color="${hex}" aria-label="Paint with ${name}" aria-pressed="false" title="${name}"><span style="--paint-color:${hex}" aria-hidden="true"></span><small>${name}</small></button>`).join('')}</div></fieldset>
      <fieldset class="paint-custom"><legend>Mix a color</legend>${['Hue','Saturation','Value'].map((name,i)=>`<div class="paint-range"><label for="paint-${name.toLowerCase()}">${name}</label><output id="paint-${name.toLowerCase()}-value" for="paint-${name.toLowerCase()}"></output><input id="paint-${name.toLowerCase()}" type="range" min="0" max="${i===0?360:100}" step="1" data-hand-range aria-label="Paint ${name.toLowerCase()}" aria-describedby="paint-slider-help"></div>`).join('')}<p id="paint-slider-help">Pinch and slide to mix · or use touch, mouse, or arrow keys</p></fieldset>`;
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('click',event=>{
      const swatch=event.target.closest('[data-paint-color]');
      if(swatch){this.setColor(swatch.dataset.paintColor);this.onChange(this.color);}
    });
    this.inputs=[...root.querySelectorAll('input')];
    this.inputs.forEach((input,i)=>input.addEventListener('input',()=>{
      this.hsv[i]=Number(input.value);this.color=hsvToHex(...this.hsv);this.render();this.onChange(this.color);
    }));
    stage.append(root);this.setColor(color);
  }
  setColor(color) {
    this.color=color.toLowerCase();this.hsv=hexToHsv(this.color,this.hsv?.[0]);this.render();
  }
  render() {
    const root=this.element,[h,s,v]=this.hsv;
    root.querySelector('#paint-color-name').textContent=CLAY_COLORS.find(([,hex])=>hex===this.color)?.[0] ?? 'Custom color';
    root.querySelector('.paint-hex').textContent=this.color.toUpperCase();
    root.querySelector('.paint-preview-chip').style.background=this.color;
    this.inputs.forEach((input,i)=>{
      input.value=String(Math.round(this.hsv[i]));
      const value=`${Math.round(this.hsv[i])}${i===0?'°':'%'}`;
      input.setAttribute('aria-valuetext',value);root.querySelector(`#${input.id}-value`).textContent=value;
    });
    this.inputs[1].style.background=`linear-gradient(to right,${hsvToHex(h,0,v)},${hsvToHex(h,100,v)})`;
    this.inputs[2].style.background=`linear-gradient(to right,#000,${hsvToHex(h,s,100)})`;
    for(const button of root.querySelectorAll('[data-paint-color]'))button.setAttribute('aria-pressed',String(button.dataset.paintColor===this.color));
  }
}
