import selectIcon from '../assets/select.png';
import pinchIcon from '../assets/pinch.png';
import openPalmIcon from '../assets/open palm.png';
import closedPalmIcon from '../assets/closed palm.png';
import { createTutorialRecipe, acceptsTutorialAction, outwardGuideTarget } from './tutorialRecipes.js';

// Shares the studio render loop; the overlay never captures clay input.
export class StudioTutorial {
  constructor({ stage, onStep, isBusy, onFinish, onTryOn, onPrepare, locate, getControlMode = () => 'index' }) {
    Object.assign(this, { onStep, isBusy, onFinish, onTryOn, onPrepare, locate, getControlMode });
    this.run = 0;
    try { const run=Number(localStorage.getItem('clayplay-tutorial-run')); if(Number.isSafeInteger(run)&&run>=0)this.run=run; } catch {}
    this.index = 0;
    this.card = document.createElement('section');
    this.card.id = 'studio-tutorial'; this.card.className = 'studio-tutorial'; this.card.hidden = true;
    this.card.setAttribute('aria-labelledby', 'tutorial-title');
    this.card.innerHTML = `<div class="tutorial-heading"><span id="tutorial-step"></span><button id="tutorial-skip" type="button">Skip tutorial</button></div>
      <div class="tutorial-lesson" aria-live="polite" aria-atomic="true"><h2 id="tutorial-title"></h2><p id="tutorial-copy"></p></div>
      <div class="tutorial-actions"><button id="tutorial-next" type="button">Try it on!</button></div>
      <button id="tutorial-explore" type="button" hidden>Try another recipe</button>`;
    this.overlay = document.createElement('div');
    this.overlay.className = 'tutorial-overlay'; this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `<div class="mission-target"><span class="mission-ring"></span><span class="mission-dot"></span>
      <div class="mission-direction">
      <svg class="mission-path" viewBox="0 0 140 140"><path d="M70 110 L70 25 M59 38 L70 25 L81 38"/></svg>
      <div class="mission-travel"><div class="mission-hand"><img class="mission-open" src="${selectIcon}" alt=""><img class="mission-pinched" src="${pinchIcon}" alt=""></div></div>
      </div></div>`;
    stage.append(this.overlay, this.card);
    this.nextButton = this.card.querySelector('#tutorial-next');
    this.copy = this.card.querySelector('#tutorial-copy');
    this.card.addEventListener('pointerdown', event => event.stopPropagation());
    this.nextButton.addEventListener('click', async () => {
      if(this.preparing)return;
      if (this.isBusy()) { this.copy.textContent = 'Release and let the clay settle first.'; return; }
      if (this.phase==='ui' || this.phase==='shape') {
        const phase=this.phase==='ui' ? 'shape' : 'eyes';
        this.preparing=true;this.nextButton.disabled=true;
        try { await this.onPrepare(this.recipe,phase);this.phase=phase;this.show(); }
        catch(error) {this.copy.textContent=error.message || 'Could not prepare this mask; try again.';}
        finally {this.preparing=false;this.nextButton.disabled=false;}
        return;
      }
      if(this.phase==='eyes'){this.phase='create';this.show();return;}
      this.finish(); this.onTryOn?.();
    });
    this.card.querySelector('#tutorial-skip').addEventListener('click', () => {
      if(this.preparing)return;
      if (this.isBusy()) { this.copy.textContent = 'Release to continue.'; return; }
      this.finish('skip');
    });
    this.card.querySelector('#tutorial-explore').addEventListener('click', () => this.start());
  }
  get active() { return !this.card.hidden; }
  get learningUI() { return this.active && this.phase!=='create'; }
  start() {
    if (this.isBusy() || this.preparing) return;
    this.recipe=createTutorialRecipe(this.run++);
    try {localStorage.setItem('clayplay-tutorial-run',String(this.run));}catch{}
    this.index=0;this.phase='ui';this.card.hidden=false;this.show();
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
    this.overlay.querySelector('.mission-open').src = palm ? openPalmIcon : selectIcon;
    this.overlay.querySelector('.mission-pinched').src = palm ? closedPalmIcon : pinchIcon;
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
    if(!this.active || this.phase!=='create' || !acceptsTutorialAction(this.mission,tool,data))return;
    this.index++;this.show();
  }
  update({ held, contact }) {
    if (!this.active) return;
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
  finish(reason = 'complete') { this.card.hidden = true; this.overlay.hidden = true; this.onFinish?.(reason); }
}
