import selectIcon from '../assets/select.png';
import pinchIcon from '../assets/pinch.png';

const lessons = [
  {
    id: 'buttons', title: 'Hold to select',
    description: 'Point your index at Next and hold for half a second until the ring fills. Move away before choosing again.',
    demo: `<rect x="151" y="33" width="91" height="53" rx="12" class="demo-button"/><text x="196" y="65" text-anchor="middle">Next</text>
      <g class="demo-point"><image href="${selectIcon}" x="4" y="15" width="90" height="90"/><circle cx="38" cy="23" r="8" class="demo-tip"/></g>
      <circle cx="196" cy="45" r="15" class="demo-dwell"/><text x="140" y="138" text-anchor="middle">0.5 seconds</text>`,
  },
  {
    id: 'pinch', title: 'Pinch, pull, release', tool: 'pinch',
    description: 'Point at a solid mask patch. Pinch thumb and index together, drag while held, then open your fingers to keep the shape. Undo lets you try again.',
    demo: `<path d="M76 24Q48 63 76 105Q116 128 152 103Q176 63 152 24Q114 8 76 24Z" class="demo-mask"/>
      <path d="M149 46Q151 65 149 84L199 65Z" class="demo-pull-patch"/>
      <g class="demo-pinch"><image href="${pinchIcon}" x="139" y="8" width="110" height="110"/><circle cx="163" cy="65" r="8" class="demo-tip"/></g>`,
  },
  {
    id: 'erase', title: 'Pinch, brush, erase', tool: 'erase',
    description: 'Pinch to activate the circle. Move over the mask to erase everything inside it. Release to stop. Undo brings it back.',
    demo: `<path d="M86 24Q54 63 86 105Q126 128 162 103Q186 63 162 24Q124 8 86 24Z" class="demo-mask"/>
      <path d="M106 77H156" class="demo-erase-trail"/>
      <g class="demo-erase-hand"><image href="${pinchIcon}" x="84" y="25" width="100" height="100"/><circle cx="106" cy="77" r="19" class="demo-erase-circle"/></g>`,
  },
];

// CSS animates the examples; this guide never starts another tracking loop.
export class StudioTutorial {
  constructor({ stage, onStep, isBusy, onFinish }) {
    Object.assign(this, { onStep, isBusy, onFinish });
    this.index = -1;
    this.card = document.createElement('section');
    this.card.id = 'studio-tutorial'; this.card.className = 'studio-tutorial'; this.card.hidden = true;
    this.card.setAttribute('aria-labelledby', 'tutorial-title');
    this.card.innerHTML = `<div class="tutorial-heading"><span id="tutorial-step"></span><button id="tutorial-skip" type="button">Skip tutorial</button></div>
      <div class="tutorial-lesson" aria-live="polite" aria-atomic="true">
        <h2 id="tutorial-title"></h2>
        <svg class="tutorial-demo" viewBox="0 0 280 150" role="img"></svg>
      </div>
      <div class="tutorial-actions"><span id="tutorial-help" role="status" hidden></span><button id="tutorial-next" type="button">Next</button></div>`;
    stage.append(this.card);
    this.nextButton = this.card.querySelector('#tutorial-next');
    this.help = this.card.querySelector('#tutorial-help');
    this.card.addEventListener('pointerdown', event => event.stopPropagation());
    this.nextButton.addEventListener('click', () => this.advance());
    this.card.querySelector('#tutorial-skip').addEventListener('click', () => this.finish());
  }
  get active() { return !this.card.hidden; }
  start() { this.index = 0; this.card.hidden = false; this.show(); }
  advance() {
    if (!this.active) return;
    if (this.isBusy()) { this.help.hidden = false; this.help.textContent = 'Release to continue.'; return; }
    if (this.index === lessons.length - 1) { this.finish(); return; }
    this.index++; this.show();
  }
  show() {
    const lesson = lessons[this.index];
    this.card.dataset.lesson = lesson.id;
    this.card.querySelector('#tutorial-step').textContent = `GETTING STARTED · ${this.index + 1} OF ${lessons.length}`;
    this.card.querySelector('#tutorial-title').textContent = lesson.title;
    const demo = this.card.querySelector('.tutorial-demo');
    demo.innerHTML = lesson.demo;
    demo.setAttribute('aria-label', lesson.description);
    this.nextButton.textContent = this.index === lessons.length - 1 ? 'Start creating' : 'Next';
    this.help.hidden = true;
    this.onStep(lesson.tool);
  }
  finish() {
    this.card.hidden = true;
    this.onFinish?.();
  }
}
