import selectIcon from '../assets/select.png';
import pinchIcon from '../assets/pinch.png';
import openPalmIcon from '../assets/open palm.png';
import closedPalmIcon from '../assets/closed palm.png';
import { createTutorialRecipe, outwardGuideTarget } from './tutorialRecipes.js';
import { TutorialEntrance } from './tutorialEntrance.js';
import { TutorialStepGate } from './tutorialProgress.js';

// Shares the studio render loop; the overlay never captures clay input.
export class StudioTutorial {
  constructor({ stage, onStep, isBusy, isApplying = () => false, onFinish, onTryOn, onPrepare, locate, getControlMode = () => 'index' }) {
    Object.assign(this, { onStep, isBusy, isApplying, onFinish, onTryOn, onPrepare, locate, getControlMode });
    this.stepGate=new TutorialStepGate();
    this.run = 0;
    try { const run=Number(localStorage.getItem('clayplay-tutorial-run')); if(Number.isSafeInteger(run)&&run>=0)this.run=run; } catch {}
    this.index = 0;
    this.card = document.createElement('section');
    this.card.id = 'studio-tutorial'; this.card.className = 'studio-tutorial'; this.card.hidden = true;
    this.card.setAttribute('aria-labelledby', 'tutorial-title');
    this.card.innerHTML = `<div class="tutorial-heading"><span id="tutorial-step"></span><button id="tutorial-skip" type="button">Skip tutorial</button></div>
      <div class="tutorial-lesson" aria-live="polite" aria-atomic="true"><h2 id="tutorial-title" tabindex="-1"></h2><p id="tutorial-copy"></p></div>
      <div class="tutorial-actions"><button id="tutorial-next" type="button">Try it on!</button></div>
      <button id="tutorial-explore" type="button" hidden>Try another recipe</button>`;
    this.overlay = document.createElement('div');
    this.overlay.className = 'tutorial-overlay'; this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `<div class="mission-target"><span class="mission-ring"></span><span class="mission-dot"></span>
      <div class="mission-direction">
      <svg class="mission-path" viewBox="0 0 140 140"><path d="M70 110 L70 25 M59 38 L70 25 L81 38"/></svg>
      <div class="mission-travel"><div class="mission-hand"><span class="mission-gesture mission-open" style="--gesture-icon:url('${selectIcon}')"></span><span class="mission-gesture mission-pinched" style="--gesture-icon:url('${pinchIcon}')"></span></div></div>
      </div></div>`;
    stage.append(this.overlay, this.card);
    this.nextButton = this.card.querySelector('#tutorial-next');
    this.copy = this.card.querySelector('#tutorial-copy');
    this.entrance=new TutorialEntrance({card:this.card,stage,onSettled:()=>{if(!this.preparing)this.nextButton.disabled=false;}});
    this.card.addEventListener('pointerdown', event => event.stopPropagation());
    this.nextButton.addEventListener('click', async () => {
      if(this.preparing || this.entrance.running || this.stepGate.pending)return;
      if(this.isApplying()){this.showApplying();return;}
      if (this.isBusy()) { this.copy.textContent = 'Release and let the clay settle first.'; return; }
      if (this.phase==='ui' || this.phase==='shape') {
        const phase=this.phase==='ui' ? 'shape' : 'eyes';
        this.preparing=true;this.nextButton.disabled=true;
        try { await this.onPrepare(this.recipe,phase);this.phase=phase;this.show(); }
        catch(error) {this.copy.textContent=error.message || 'Could not prepare this mask; try again.';}
        finally {this.preparing=false;this.nextButton.disabled=this.isApplying();}
        return;
      }
      if(this.phase==='eyes'){this.phase='create';this.show();return;}
      this.finish(); this.onTryOn?.();
    });
    this.card.querySelector('#tutorial-skip').addEventListener('click', () => {
      if(this.preparing)return;
      if (this.isBusy() || this.isApplying()) { this.copy.textContent = 'Let your change finish applying first.'; return; }
      this.finish('skip');
    });
    this.card.querySelector('#tutorial-explore').addEventListener('click', () => this.start());
  }
  get active() { return !this.card.hidden; }
  get learningUI() { return this.active && this.phase!=='create'; }
  start() {
    if (this.isBusy() || this.isApplying() || this.preparing) return;
    this.entrance.cancel(false);
    this.stepGate.reset();
    this.recipe=createTutorialRecipe(this.run++);
    try {localStorage.setItem('clayplay-tutorial-run',String(this.run));}catch{}
    this.index=0;this.phase='ui';this.card.hidden=false;this.show();
    this.overlay.hidden=true;this.nextButton.disabled=true;
    this.entrance.start();
    this.card.querySelector('#tutorial-title').focus({preventScroll:true});
  }
  get mission() {
    if(this.phase==='ui')return {id:'ui',title:'Your hand is the cursor.',copy:'Point at “Let’s create” and hold until it is selected.'};
    if(this.phase==='shape') {
      const label=this.recipe.shapeLabel.toLowerCase();
      return {id:'shape',title:`Starting with the ${label}${label.endsWith('mask')?'':' mask'}.`,copy:'Find more shapes in More → Masks.'};
    }
    if(this.phase==='eyes')return {id:'eyes',title:`Using the ${this.recipe.eyeLabel.toLowerCase()} eye style.`,copy:'Change your expression in More → Mask eyes.'};
    return this.recipe.steps[this.index] ?? {id:'done',title:'Meet your new character.',copy:'Try it on or explore another recipe.'};
  }
  show() {
    const mission = this.mission;
    this.waiting=false;delete this.card.dataset.applying;
    this.started = performance.now();
    this.card.dataset.lesson = mission.id;
    this.card.querySelector('#tutorial-step').textContent = this.phase==='ui' ? '1 · HAND CURSOR' : this.phase==='shape' ? '2 · MASK SHAPE' : this.phase==='eyes' ? '3 · EYE STYLE' : mission.target ? `${this.index+4} · ${mission.tool==='pinch'?'PULL':mission.tool.toUpperCase()}` : 'MADE BY YOU';
    this.card.querySelector('#tutorial-title').textContent = mission.title;
    this.card.querySelector('#tutorial-copy').textContent = mission.copy;
    this.card.querySelector('#tutorial-explore').hidden = mission.id!=='done';
    this.nextButton.hidden = Boolean(mission.target);
    this.nextButton.textContent = this.phase==='ui' ? 'Let’s create' : this.phase==='shape' || this.phase==='eyes' ? 'Next' : 'Try it on!';
    this.overlay.dataset.motion = mission.motion ?? mission.id;
    this.onStep(mission.tool, mission);
    this.refreshControlGuidance();
  }
  instruction(text) {
    if (this.getControlMode() !== 'palm') return text;
    return text.replace(/pinch thumb and index together/gi, 'close your palm')
      .replace(/pinch/gi, 'close your palm').replace(/open your fingers/gi, 'open your palm')
      .replace(/point your index/gi, 'move your open palm').replace(/point at/gi, 'move your open palm to')
      .replace(/point here/gi, 'open palm here').replace(/point,/gi, 'Open palm,');
  }
  refreshControlGuidance() {
    this.guideMode = this.getControlMode();
    const palm = this.guideMode === 'palm';
    // Cursor hotspot is the fingertip inside each transparent 512px icon,
    // rather than the icon's bounding box or the center of the hand.
    this.overlay.style.setProperty('--gesture-tip-x',palm?'-.4873':'-.3740');
    this.overlay.style.setProperty('--gesture-tip-y',palm?'-.0410':'-.0762');
    this.overlay.querySelector('.mission-open').style.setProperty('--gesture-icon',`url("${palm ? openPalmIcon : selectIcon}")`);
    this.overlay.querySelector('.mission-pinched').style.setProperty('--gesture-icon',`url("${palm ? closedPalmIcon : pinchIcon}")`);
    this.card.querySelector('#tutorial-copy').textContent = this.phase==='ui' && palm
      ? 'Move your open palm over “Let’s create” and hold until it is selected.'
      : this.mission.copy && this.instruction(this.mission.copy);
  }
  recordPull(warp) {
    this.recordAction('pinch',warp);
  }
  recordPaint(point,stroke) {
    this.recordAction('paint',{point:point?.toArray(),...stroke});
  }
  recordAction(tool,data) {
    if(!this.active || this.phase!=='create' || !this.stepGate.record(this.mission,tool,data))return;
    this.showApplying();
  }
  showApplying(held=false) {
    this.waiting=true;this.card.dataset.applying='true';this.overlay.hidden=true;
    this.nextButton.disabled=true;
    this.copy.textContent=held ? (this.getControlMode()==='palm'?'Open your hand to finish this step.':'Release to finish this step.') : 'Applying your change… Please wait.';
  }
  update({ held, contact }) {
    if (!this.active) return;
    if(this.entrance.running){this.overlay.hidden=true;return;}
    const applying=this.isApplying();
    if(this.stepGate.pending) {
      if(this.stepGate.update({busy:this.isBusy() || applying,held})) {
        this.index++;this.show();
      } else {this.showApplying(held);return;}
    }
    if(applying && !held){this.showApplying();return;}
    if(this.waiting) {
      this.waiting=false;delete this.card.dataset.applying;
      this.refreshControlGuidance();
    }
    this.nextButton.disabled=this.preparing || applying;
    if (this.guideMode !== this.getControlMode()) this.refreshControlGuidance();
    const mission = this.mission;
    let point = mission.target && this.locate(mission.target);
    if (this.phase==='ui') {
      const button = this.nextButton.getBoundingClientRect();
      const stage = this.overlay.parentElement.getBoundingClientRect();
      point = { x: button.left - stage.left + button.width / 2, y: button.top - stage.top + button.height / 2 };
    }
    this.overlay.hidden = !point;
    if (point) {
      const target = this.overlay.firstElementChild;
      target.style.left = `${point.x}px`; target.style.top = `${point.y}px`;
      if(mission.target) {
        const end=this.locate(outwardGuideTarget(mission));
        if(end) {
          const dx=end.x-point.x,dy=end.y-point.y;
          target.style.setProperty('--guide-angle',`${Math.atan2(dx,-dy)*180/Math.PI}deg`);
        }
      }
      this.overlay.dataset.held = String(held && contact);
    }

  }
  finish(reason = 'complete') { this.entrance.cancel();this.stepGate.reset();this.card.hidden = true; this.overlay.hidden = true; this.onFinish?.(reason); }
}
