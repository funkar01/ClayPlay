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
    this.onChange=onChange; this.recent=[];
    const root=this.element=document.createElement('section');
    root.className='paint-palette';root.hidden=true;root.setAttribute('aria-label','Paint colors');
    root.innerHTML=`<header class="paint-palette-heading"><strong>Paint color</strong><div class="paint-scroll"><button type="button" id="paint-collapse" aria-label="Collapse paint colors" aria-expanded="true">−</button><button type="button" id="paint-scroll-up" data-paint-scroll="-1" aria-label="Scroll paint colors up">↑</button><button type="button" id="paint-scroll-down" data-paint-scroll="1" aria-label="Scroll paint colors down">↓</button></div></header>
      <div class="paint-preview"><span class="paint-preview-chip" aria-hidden="true"></span><div><strong id="paint-color-name"></strong><output class="paint-hex" aria-label="Selected paint color"></output></div></div>
      <fieldset class="paint-basic"><legend>Basic colors</legend><div class="paint-swatches">${CLAY_COLORS.map(([name,hex],i)=>`<button type="button" id="paint-swatch-${i}" data-paint-color="${hex}" aria-label="Paint with ${name}" aria-pressed="false" title="${name}"><span style="--paint-color:${hex}" aria-hidden="true"></span><small>${name}</small></button>`).join('')}</div></fieldset>
      <fieldset class="paint-recent" hidden><legend>Recent mixes</legend><div class="paint-swatches"></div></fieldset><details class="paint-mixer"><summary id="paint-mix-toggle">Mix a color</summary><fieldset class="paint-custom"><legend class="visually-hidden">Custom color</legend>${['Hue','Saturation','Value'].map((name,i)=>`<div class="paint-range"><label for="paint-${name.toLowerCase()}">${['Color','Intensity','Brightness'][i]}</label><output id="paint-${name.toLowerCase()}-value" for="paint-${name.toLowerCase()}"></output><input id="paint-${name.toLowerCase()}" type="range" min="0" max="${i===0?360:100}" step="1" data-hand-range aria-label="Paint ${['color','intensity','brightness'][i]}" aria-describedby="paint-slider-help"><div class="paint-adjust"><button type="button" data-adjust="${i}:-1" aria-label="Less ${['color','intensity','brightness'][i]}">−</button><button type="button" data-adjust="${i}:1" aria-label="More ${['color','intensity','brightness'][i]}">＋</button></div></div>`).join('')}<p id="paint-slider-help">Pinch and slide to mix · or use touch, mouse, or arrow keys</p></fieldset></details>`;
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('click',event=>{
      const collapse=event.target.closest('#paint-collapse');
      if(collapse){const compact=root.classList.toggle('is-compact');root.scrollTop=0;collapse.textContent=compact?'＋':'−';collapse.setAttribute('aria-expanded',String(!compact));collapse.setAttribute('aria-label',compact?'Expand paint colors':'Collapse paint colors');return;}
      const scroll=event.target.closest('[data-paint-scroll]');
      if(scroll){root.scrollBy({top:Number(scroll.dataset.paintScroll)*180,behavior:'smooth'});return;}
      const adjust=event.target.closest('[data-adjust]');
      if(adjust){this.rememberColor();const [i,delta]=adjust.dataset.adjust.split(':').map(Number);const input=this.inputs[i];input.value=String(Number(input.value)+delta*(i===0?5:2));input.dispatchEvent(new Event('input',{bubbles:true}));return;}
      const swatch=event.target.closest('[data-paint-color]');
      if(swatch){this.rememberColor();this.setColor(swatch.dataset.paintColor);this.onChange(this.color);}
    });
    this.inputs=[...root.querySelectorAll('input')];
    this.inputs.forEach(input=>{input.onHandAdjustStart=()=>this.rememberColor();input.addEventListener('pointerdown',()=>this.rememberColor());});
    this.inputs.forEach(input=>input.addEventListener('keydown',()=>this.rememberColor()));
    this.inputs.forEach((input,i)=>input.addEventListener('input',()=>{
      this.hsv[i]=Number(input.value);this.color=hsvToHex(...this.hsv);this.render();this.onChange(this.color);
    }));
    stage.append(root);this.setColor(color);
  }
  rememberColor() {
    if(!this.color || CLAY_COLORS.some(([,hex])=>hex===this.color) || this.recent.includes(this.color))return;
    // Store a mix when the user starts a different adjustment, not every frame.
    this.recent=[this.color,...this.recent].slice(0,4);
    const section=this.element.querySelector('.paint-recent');section.hidden=false;
    const swatches=section.querySelector('.paint-swatches');
    swatches.replaceChildren(...this.recent.map((hex,i)=>{
      const item=document.createElement('button');item.type='button';item.id=`recent-paint-${i}`;
      item.dataset.paintColor=hex;item.setAttribute('aria-label',`Use recent color ${hex}`);
      const chip=document.createElement('span');chip.style.setProperty('--paint-color',hex);chip.setAttribute('aria-hidden','true');
      item.append(chip);return item;
    }));
  }
  setControlMode(mode) {
    if(this.controlMode===mode)return;
    this.controlMode=mode;
    this.element.querySelector('#paint-slider-help').textContent=mode==='palm' ? 'Close your hand and slide · open to finish. Mouse, touch and arrow keys work too.' : 'Pinch and slide · release to finish. Mouse, touch and arrow keys work too.';
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
