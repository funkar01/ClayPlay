// Animate from the stage center to the card's actual responsive dock position.
// Only transforms move; the drawing loop and the final layout stay unchanged.
export class TutorialEntrance {
  constructor({card,stage,onSettled,reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,events=globalThis.window}) {
    Object.assign(this,{card,stage,onSettled,reducedMotion,events});
    this.onResize=()=>this.cancel();
  }
  start() {
    this.cancel(false);
    if(this.reducedMotion() || typeof this.card.animate!=='function') {this.onSettled();return;}
    const stage=this.stage.getBoundingClientRect(),card=this.card.getBoundingClientRect();
    if(!stage.width || !stage.height || !card.width || !card.height) {this.onSettled();return;}
    const dx=stage.left+stage.width/2-card.left-card.width/2;
    const dy=stage.top+stage.height/2-card.top-card.height/2;
    const centered=`translate(${dx}px, ${dy}px)`;
    this.running=true;
    this.animation=this.card.animate([
      {transform:centered,offset:0},
      {transform:centered,offset:1400/2350,easing:'cubic-bezier(.22,.61,.36,1)'},
      {transform:'translate(0px, 0px)',offset:1},
    ],{duration:2350});
    const animation=this.animation;
    animation.onfinish=()=>{if(this.animation===animation)this.cancel();};
    animation.oncancel=()=>{if(this.animation===animation)this.cancel();};
    this.events?.addEventListener('resize',this.onResize,{once:true});
  }
  cancel(notify=true) {
    const animation=this.animation,wasRunning=this.running;
    this.animation=null;this.running=false;
    this.events?.removeEventListener('resize',this.onResize);
    animation?.cancel();
    if(notify && wasRunning)this.onSettled();
  }
}
