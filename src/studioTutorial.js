import selectIcon from '../assets/select.png';
import pinchIcon from '../assets/pinch.png';
import openPalmIcon from '../assets/open palm.png';
import closedPalmIcon from '../assets/closed palm.png';
import { missions, acceptsTutorialPull } from './tutorialMission.js';

// Shares the studio render loop; the overlay never captures clay input.
export class StudioTutorial {
  constructor({ stage, onStep, isBusy, onFinish, onTryOn, locate, getControlMode = () => 'index' }) {
    Object.assign(this, { onStep, isBusy, onFinish, onTryOn, locate, getControlMode });
    this.index = 0;
    this.card = document.createElement('section');
    this.card.id = 'studio-tutorial'; this.card.className = 'studio-tutorial'; this.card.hidden = true;
    this.card.setAttribute('aria-labelledby', 'tutorial-title');
    this.card.innerHTML = `<div class="tutorial-heading"><span id="tutorial-step"></span><button id="tutorial-skip" type="button">Skip tutorial</button></div>
      <div class="tutorial-lesson" aria-live="polite" aria-atomic="true"><h2 id="tutorial-title"></h2><p id="tutorial-copy"></p></div>
      <div class="tutorial-actions"><button id="tutorial-demo" type="button" aria-pressed="true">Hide guide</button><button id="tutorial-next" type="button">Try it on!</button></div>
      <button id="tutorial-explore" type="button" hidden>Add more personality</button>`;
    this.overlay = document.createElement('div');
    this.overlay.className = 'tutorial-overlay'; this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `<div class="mission-target"><span class="mission-ring"></span><span class="mission-dot"></span>
      <svg class="mission-path" viewBox="0 0 140 140"><path d="M70 110 L70 25 M59 38 L70 25 L81 38"/></svg>
      <div class="mission-hand"><img class="mission-open" src="${selectIcon}" alt=""><img class="mission-pinched" src="${pinchIcon}" alt=""></div>
      </div>`;
    stage.append(this.overlay, this.card);
    this.nextButton = this.card.querySelector('#tutorial-next');
    this.copy = this.card.querySelector('#tutorial-copy');
    this.card.addEventListener('pointerdown', event => event.stopPropagation());
    this.nextButton.addEventListener('click', () => {
      if (this.isBusy()) { this.copy.textContent = 'Release and let the clay settle first.'; return; }
      if (this.learningUI) { this.learningUI = false; this.show(); return; }
      this.finish(); this.onTryOn?.();
    });
    this.card.querySelector('#tutorial-skip').addEventListener('click', () => {
      if (this.isBusy()) { this.copy.textContent = 'Release to continue.'; return; }
      this.finish('skip');
    });
    this.card.querySelector('#tutorial-demo').addEventListener('click', event => {
      this.demonstrating = !this.demonstrating;
      event.currentTarget.textContent = this.demonstrating ? 'Hide guide' : 'Show me';
      event.currentTarget.setAttribute('aria-pressed', String(this.demonstrating));
    });
    this.card.querySelector('#tutorial-explore').addEventListener('click', () => { this.index = 3; this.show(); });
  }
  get active() { return !this.card.hidden; }
  get learningUI() { return this.active && this.uiStep; }
  set learningUI(value) { this.uiStep = value; }
  start() { if (this.isBusy()) return; this.index = 0; this.card.hidden = false; this.learningUI = true; this.show(); }
  get mission() {
    return this.learningUI ? { id: 'ui', title: 'Your hand is the cursor.',
      copy: 'Point at “Let’s create” and hold until the ring fills.' } : missions[this.index];
  }
  show() {
    const mission = this.mission;
    this.demonstrating = true; this.started = performance.now();
    this.card.dataset.lesson = mission.id;
    this.card.querySelector('#tutorial-step').textContent = this.learningUI ? 'FIRST · TRY THE HAND CURSOR' : this.index < 2 ? `YOUR FIRST CREATION · ${this.index + 1} / 2` : 'MADE BY YOU';
    this.card.querySelector('#tutorial-title').textContent = mission.title;
    this.card.querySelector('#tutorial-copy').textContent = mission.copy;
    const demo = this.card.querySelector('#tutorial-demo');
    demo.hidden = !mission.target && !this.learningUI; demo.textContent = 'Hide guide'; demo.setAttribute('aria-pressed', 'true');
    this.card.querySelector('#tutorial-explore').hidden = this.learningUI || this.index !== 2;
    this.nextButton.hidden = Boolean(mission.target);
    this.nextButton.textContent = this.learningUI ? 'Let’s create' : 'Try it on!';
    this.overlay.dataset.motion = mission.id;
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
    this.card.querySelector('#tutorial-copy').textContent = this.learningUI && palm
      ? 'Move your open palm over “Let’s create” and hold until the ring fills.'
      : this.mission.copy && this.instruction(this.mission.copy);
  }
  recordPull(warp) {
    if (!this.active || this.learningUI || !acceptsTutorialPull(missions[this.index], warp)) return;
    // A mirrored first pull already creates both horns.
    this.index += this.index === 0 && warp.symmetry ? 2 : 1;
    this.show();
  }
  recordPaint(point) {
    if (!this.active || this.learningUI || missions[this.index].id !== 'cheeks' || !point) return;
    if (Math.hypot(point.x - .64, point.y + .16) > .4) return;
    this.index++; this.show();
  }
  update({ held, contact }) {
    if (!this.active) return;
    if (this.guideMode !== this.getControlMode()) this.refreshControlGuidance();
    const mission = this.mission;
    let point = mission.target && this.locate(mission.target);
    if (this.learningUI) {
      const button = this.nextButton.getBoundingClientRect();
      const stage = this.overlay.parentElement.getBoundingClientRect();
      point = { x: button.left - stage.left + button.width / 2, y: button.top - stage.top + button.height / 2 };
    }
    this.overlay.hidden = !point || !this.demonstrating;
    if (point) {
      const target = this.overlay.firstElementChild;
      target.style.left = `${point.x}px`; target.style.top = `${point.y}px`;
      this.overlay.dataset.held = String(held && contact);
    }

  }
  finish(reason = 'complete') { this.card.hidden = true; this.overlay.hidden = true; this.onFinish?.(reason); }
}
