import { MASK_SHAPES, EYE_SHAPES, eyePreview } from './clayShapes.js';

export class MaskShapePicker {
  constructor({ stage, onChoose, onOpen }) {
    this.onChoose = onChoose;
    this.onOpen = onOpen;
    this.card = document.createElement('section');
    this.card.id = 'mask-shape-picker';
    this.card.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'mask-picker-title');
    this.card.innerHTML = `<div class="mask-picker-card"><span class="mask-picker-eyebrow">YOUR NEXT CREATION</span>
      <h2 id="mask-picker-title">Every mask starts with a shape.</h2>
      <p>Pick a clay canvas. Give it your own character.</p>
      <div class="mask-picker-grid">${Object.entries(MASK_SHAPES).map(([key, shape]) => `<button type="button" data-mask-base="${key}" aria-pressed="${key === 'full'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shape.icon}"/><ellipse cx="9.2" cy="10" rx="1.5" ry=".7"/><ellipse cx="14.8" cy="10" rx="1.5" ry=".7"/></svg><strong>${shape.label}</strong><span>${shape.description}</span></button>`).join('')}</div>
      <div class="mask-picker-grid eye-picker-grid" hidden>${Object.entries(EYE_SHAPES).map(([key, eyes]) => `<button type="button" data-eye-base="${key}" aria-pressed="${key === 'oval'}">${eyePreview(key)}<strong>${eyes.label}</strong><span>${eyes.description}</span></button>`).join('')}</div>
      <div class="mask-picker-footer"><button type="button" class="mask-picker-back" hidden>← Mask shapes</button><span role="status">Step 1 of 2 · Choose your mask.</span><button type="button" class="mask-picker-start">Choose eye shape →</button></div></div>`;
    stage.append(this.card);
    this.selected = 'full';
    this.eyeShape = 'oval';
    this.step = 'mask';
    this.card.addEventListener('pointerdown', e => e.stopPropagation());
    this.card.addEventListener('click', e => {
      const eyeOption = e.target.closest('[data-eye-base]');
      if (eyeOption && !this.busy) {
        this.eyeShape = eyeOption.dataset.eyeBase;
        this.card.querySelectorAll('[data-eye-base]').forEach(b => b.setAttribute('aria-pressed', String(b === eyeOption)));
        return;
      }
      const option = e.target.closest('[data-mask-base]');
      if (!option || this.busy) return;
      this.selected = option.dataset.maskBase;
      this.card.querySelectorAll('[data-mask-base]').forEach(b => b.setAttribute('aria-pressed', String(b === option)));
    });
    this.card.querySelector('.mask-picker-back').addEventListener('click', () => this.showStep('mask'));
    this.card.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const buttons = [...this.card.querySelectorAll('button:not(:disabled)')].filter(b => !b.closest('[hidden]'));
      const first = buttons[0], last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    this.card.querySelector('.mask-picker-start').addEventListener('click', async () => {
      if (this.busy) return;
      if (this.step === 'mask') { this.showStep('eyes'); return; }
      this.busy = true;
      this.card.querySelectorAll('button').forEach(b => b.disabled = true);
      const status = this.card.querySelector('[role="status"]');
      status.textContent = 'Preparing your clay canvas…';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        await this.onChoose(this.selected, this.eyeShape);
        this.card.hidden = true;
        document.querySelector('#tool-pinch').focus({ preventScroll: true });
      } catch (error) {
        console.error(error);
        status.textContent = 'Could not prepare this mask. Please try again.';
      } finally {
        this.busy = false;
        this.card.querySelectorAll('button').forEach(b => b.disabled = false);
      }
    });
  }
  get active() { return !this.card.hidden; }
  showStep(step) {
    this.step = step;
    const eyes = step === 'eyes';
    this.card.querySelector('.mask-picker-grid:not(.eye-picker-grid)').hidden = eyes;
    this.card.querySelector('.eye-picker-grid').hidden = !eyes;
    this.card.querySelector('.mask-picker-back').hidden = !eyes;
    this.card.querySelector('#mask-picker-title').textContent = eyes ? 'Give your mask an expression.' : 'Every mask starts with a shape.';
    this.card.querySelector('.mask-picker-card > p').textContent = eyes ? `${MASK_SHAPES[this.selected].label} · Choose the openings that bring it to life.` : 'Pick a clay canvas. Give it your own character.';
    this.card.querySelector('[role="status"]').textContent = eyes ? 'Step 2 of 2 · Choose your eyes.' : 'Step 1 of 2 · Choose your mask.';
    this.card.querySelector('.mask-picker-start').textContent = eyes ? 'Create this mask →' : 'Choose eye shape →';
    this.card.querySelector(eyes ? `[data-eye-base="${this.eyeShape}"]` : `[data-mask-base="${this.selected}"]`).focus({ preventScroll: true });
  }
  open() {
    this.onOpen();
    this.card.hidden = false;
    this.showStep('mask');
  }
}
