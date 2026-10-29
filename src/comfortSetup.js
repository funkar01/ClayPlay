import { palmPosture } from './palmControl.js';

export class ComfortSetup {
  constructor({ stage, startCamera, onReady }) {
    this.onReady = onReady;
    this.card = document.createElement('section');
    this.card.className = 'comfort-setup';
    this.card.hidden = true;
    this.card.setAttribute('aria-labelledby', 'comfort-title');
    this.card.innerHTML = `<span class="comfort-step">GET COMFORTABLE</span>
      <h2 id="comfort-title" tabindex="-1">Find your comfort space</h2>
      <p>Switch on your lights. Sit comfortably about 3 feet from the camera, with your shoulders relaxed.</p>
      <p class="comfort-status" role="status"></p>
      <button type="button">I’m ready</button>
      <button class="comfort-skip" type="button">Use cursor instead</button>`;
    stage.append(this.card);
    this.title = this.card.querySelector('h2');
    this.copy = this.card.querySelector('p');
    this.status = this.card.querySelector('[role="status"]');
    this.button = this.card.querySelector('button');
    this.card.querySelector('.comfort-skip').addEventListener('click', () => {
      this.card.hidden = true;
      this.onReady(true);
    });
    this.card.addEventListener('pointerdown', event => event.stopPropagation());
    this.button.addEventListener('click', async () => {
      if (this.starting) return;
      this.starting = true;
      this.button.disabled = true;
      this.status.textContent = 'Allow camera access when asked.';
      try { await startCamera(); }
      finally { this.starting = false; }
      if (!this.active) return;
      if (!this.cameraReady()) {
        this.status.textContent = 'Camera not ready. Check camera access, then try again.';
        this.button.textContent = 'Try again';
        this.button.disabled = false;
        return;
      }
      this.phase = 'palm';
      this.card.querySelector('.comfort-step').textContent = 'CHECK YOUR HAND';
      this.title.textContent = 'Show open palm';
      this.copy.textContent = 'Face your palm toward the camera, with your wrist in view. Hold it comfortably still.';
      this.status.textContent = '';
      this.status.hidden = true;
      this.button.hidden = true;
      this.card.querySelector('.comfort-skip').hidden = true;
      this.title.focus({ preventScroll: true });
    });
  }
  get active() { return !this.card.hidden; }
  open(cameraReady) {
    this.cameraReady = cameraReady;
    this.phase = 'comfort';
    this.card.hidden = false;
    this.title.focus({ preventScroll: true });
  }
  observe(hands, aspect, now) {
    if (this.phase !== 'palm') return;
    const palm = hands.length === 1 && palmPosture(hands[0], aspect);
    if (!palm?.open || !this.lastPalm || now - this.lastAt > 300 ||
      Math.abs(palm.scale / this.lastPalm.scale - 1) > .12 ||
      Math.hypot(palm.center.x - this.lastPalm.center.x, palm.center.y - this.lastPalm.center.y) > .04) {
      this.steadySince = now;
    }
    this.lastPalm = palm;
    this.lastAt = now;
    if (palm?.open && now - this.steadySince >= 1000) {
      this.palmScale = palm.scale;
      this.card.hidden = true;
      this.onReady();
    }
  }
}
