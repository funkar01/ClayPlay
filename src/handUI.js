import { HandSelection, ControlHand } from './handSelection.js';
import { palmCenter } from './twoHandScale.js';
import { closedPalm } from './palmMove.js';
import { MASK_SHAPES } from './clayShapes.js';

const colors = [
  ['Terracotta', '#bd7455'], ['Cream', '#ead5b5'], ['Rose', '#ce8793'],
  ['Sage', '#83a58b'], ['Ocean', '#6e9fba'], ['Lavender', '#a18db6'],
  ['Sunshine', '#e5bd50'], ['Coral', '#e87865'], ['Mint', '#83c6b2'],
  ['Plum', '#825b87'], ['Charcoal', '#45434a'], ['Pearl', '#f5eee1'],
];

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const channel = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function button(label, action, value) {
  const element = document.createElement('button'); element.type = 'button';
  element.textContent = label; element.dataset.handAction = action;
  if (value !== undefined) element.dataset.value = value;
  return element;
}

export class HandUI {
  constructor({ stage, getState, onAction, onPause, mapPoint }) {
    Object.assign(this, { stage, getState, onAction, onPause, mapPoint });
    this.selection = new HandSelection(); this.identity = new ControlHand();
    this.page = 'more'; this.maskPage = 0;
    this.custom = [20, 55, 60]; this.lastAt = 0;
    this.dock = document.createElement('nav'); this.dock.id = 'hand-toolbar';
    this.dock.className = 'hand-toolbar'; this.dock.setAttribute('aria-label', 'Mask studio tools');
    for (const id of ['tool-pinch', 'tool-cut']) this.dock.append(document.getElementById(id));
    this.tryIt = button('Try it', 'try'); this.tryIt.id = 'hand-try';
    this.tryIt.setAttribute('aria-label', 'Try it: wear your mask'); this.dock.append(this.tryIt);
    for (const id of ['sculpt-undo', 'sculpt-redo']) this.dock.append(document.getElementById(id));
    this.more = button('More', 'more'); this.more.id = 'hand-more';
    this.more.setAttribute('aria-expanded', 'false'); this.more.setAttribute('aria-controls', 'hand-panel');
    this.dock.append(this.more); stage.append(this.dock);
    this.panel = document.createElement('section'); this.panel.id = 'hand-panel'; this.panel.className = 'hand-panel'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Studio options'); stage.append(this.panel);
    this.done = button('Back to creating', 'try-done'); this.done.id = 'hand-try-done'; this.done.className = 'hand-try-done'; this.done.hidden = true; stage.append(this.done);
    this.cursor = document.createElement('div'); this.cursor.className = 'hand-ui-cursor'; this.cursor.hidden = true; this.cursor.setAttribute('aria-hidden', 'true'); stage.append(this.cursor);
    this.feedback = document.createElement('div'); this.feedback.id = 'hand-feedback'; this.feedback.className = 'hand-feedback'; this.feedback.hidden = true; this.feedback.setAttribute('role', 'status'); stage.append(this.feedback);
    stage.classList.add('hand-ui-ready');
    stage.addEventListener('click', event => {
      const target = event.target.closest('[data-hand-action]');
      if (target && !target.disabled) this.act(target.dataset.handAction, target.dataset.value);
    });
    window.addEventListener('resize', () => { this.signature = null; });
    this.sync();
  }
  get isOpen() { return !this.panel.hidden; }
  open(page = 'more') {
    this.page = page; this.panel.hidden = false; this.more.setAttribute('aria-expanded', 'true');
    this.onPause(); this.selection.cancel(); this.signature = null; this.sync();
  }
  close() {
    this.panel.hidden = true; this.more.setAttribute('aria-expanded', 'false');
    this.onPause(); this.selection.cancel(); this.more.focus({ preventScroll: true });
  }
  act(action, value) {
    const state = this.getState();
    if (action === 'more') { if (this.isOpen) this.close(); else this.open(); return; }
    if (action === 'close') { this.close(); return; }
    if (action === 'page') { this.open(value); return; }
    if (action === 'mask-page') { this.maskPage += Number(value); this.signature = null; this.sync(); return; }
    if (action === 'scroll') { this.body.scrollBy({ top: Number(value) * 180, behavior: 'smooth' }); return; }
    if (['reset', 'remove', 'camera-off'].includes(action)) { this.confirm = action; this.open('confirm'); return; }
    if (action === 'confirm') {
      const operation = this.confirm; this.close(); this.onAction(operation); return;
    }
    if (action === 'adjust') {
      const [axis, change] = value.split(':').map(Number);
      this.custom[axis] = axis === 0 ? (this.custom[axis] + change + 360) % 360 : Math.max(0, Math.min(100, this.custom[axis] + change));
      this.signature = null; this.sync(); return;
    }
    if (action === 'custom-apply') { this.onAction('color', hslToHex(...this.custom)); this.open('colors'); return; }
    if (action === 'try-done') { if (this.isOpen) this.close(); this.onAction('try'); return; }
    if (state.busy && ['select-mask', 'add-mask', 'try', 'position'].includes(action)) { this.announce('Finishing your edit · try again in a moment'); return; }
    this.onAction(action, value);
    if (['select-mask', 'try', 'pause'].includes(action)) this.close();
    this.signature = null; this.sync();
  }
  sync() {
    const s = this.getState(); this.done.hidden = !s.trying;
    this.tryIt.disabled = s.busy;
    this.tryIt.setAttribute('aria-pressed', String(s.trying));
    const signature = JSON.stringify([this.page, this.maskPage, this.custom, s]);
    if (!this.isOpen || signature === this.signature) return;
    this.signature = signature;
    const header = document.createElement('header');
    header.append(button(this.page === 'more' ? 'Close' : 'Back', this.page === 'more' ? 'close' : 'page', 'more'));
    const title = document.createElement('strong'); title.textContent = ({more:'Studio options',masks:'Your masks',colors:'Choose a color',custom:'Mix your color',confirm:'Are you sure?'})[this.page];
    header.append(title);
    if (this.page !== 'more') header.append(button('Close', 'close'));
    const grid = document.createElement('div'); grid.className = 'hand-panel-grid';
    this.body = document.createElement('div'); this.body.className = 'hand-panel-body'; this.body.append(grid);
    this.panel.replaceChildren(header, this.body);
    if (this.page === 'more') {
      grid.classList.add('hand-options');
      grid.append(button('Masks', 'page', 'masks'), button('Color', 'page', 'colors'));
      const symmetry = button(`Symmetry ${s.symmetry ? 'On' : 'Off'}`, 'symmetry'); symmetry.setAttribute('aria-pressed', String(s.symmetry)); symmetry.disabled = s.trying;
      symmetry.classList.add('hand-symmetry');
      const symmetryIcon = document.querySelector('#vertical-symmetry svg')?.cloneNode(true);
      if (symmetryIcon) symmetry.prepend(symmetryIcon);
      const ar = button(`AR mode ${s.ar ? 'On' : 'Off'}`, 'ar'); ar.setAttribute('aria-pressed', String(s.ar));
      const position = button('Reset position', 'position'); position.disabled = s.positionResetDisabled || s.trying;
      const reset = button('Reset mask', 'reset'); reset.disabled = !s.edited || s.busy || s.trying;
      const pause = button(s.paused ? 'Resume creating' : 'Pause editing', 'pause'); pause.disabled = s.trying;
      const camera = button('Turn camera off', 'camera-off'); camera.disabled = !s.cameraOn;
      const tutorial = button('Replay tutorial', 'tutorial'); tutorial.disabled = s.busy;
      grid.append(symmetry, ar, position, reset, pause, camera, tutorial);
    } else if (this.page === 'masks') {
      const start = Math.max(0, Math.min(this.maskPage, Math.ceil(s.masks.length / 4) - 1)); this.maskPage = start;
      for (const item of s.masks.slice(start * 4, start * 4 + 4)) {
        const card = button(item.label, 'select-mask', item.id); card.className = 'hand-mask-card'; card.disabled = s.busy;
        card.setAttribute('aria-pressed', String(item.id === s.active));
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', MASK_SHAPES[item.shape].icon); path.style.fill = item.color;
        icon.append(path); card.prepend(icon); grid.append(card);
      }
      if (s.masks.length > 4) {
        const prev = button('Previous', 'mask-page', '-1'), next = button('Next', 'mask-page', '1');
        prev.disabled = start === 0; next.disabled = (start + 1) * 4 >= s.masks.length; grid.append(prev, next);
      }
      const caption = document.createElement('p'); caption.textContent = 'Add a starter mask'; caption.className = 'hand-panel-caption'; grid.append(caption);
      for (const [shape, details] of Object.entries(MASK_SHAPES)) {
        const add = button(`＋ ${details.label}`, 'add-mask', shape); add.disabled = s.busy || s.masks.length >= 8; grid.append(add);
      }
      const remove = button('Remove selected', 'remove'); remove.disabled = s.busy || s.masks.length < 2; grid.append(remove);
    } else if (this.page === 'colors') {
      grid.classList.add('hand-colors');
      for (const [name, hex] of colors) {
        const swatch = button(name, 'color', hex); swatch.style.setProperty('--swatch', hex); swatch.className = 'hand-color';
        swatch.setAttribute('aria-pressed', String(s.color === hex)); grid.append(swatch);
      }
      grid.append(button('Mix a custom color', 'page', 'custom'));
    } else if (this.page === 'custom') {
      const preview = document.createElement('div'); preview.className = 'hand-color-preview'; preview.style.background = hslToHex(...this.custom); preview.textContent = 'Your color'; grid.append(preview);
      for (const [i, name] of ['Hue', 'Color intensity', 'Brightness'].entries()) {
        const label = document.createElement('p'); label.className = 'hand-panel-caption'; label.textContent = `${name} · ${this.custom[i]}${i ? '%' : '°'}`; grid.append(label);
        grid.append(button(`− ${name}`, 'adjust', `${i}:${i ? -10 : -20}`), button(`＋ ${name}`, 'adjust', `${i}:${i ? 10 : 20}`));
      }
      grid.append(button('Apply color', 'custom-apply'));
    } else {
      const copy = document.createElement('p'); copy.className = 'hand-confirm-copy';
      copy.textContent = this.confirm === 'camera-off' ? 'Hand controls will stop. Use the cursor to start the camera again.'
        : this.confirm === 'remove' ? 'Remove the selected mask from your collection?' : 'Start this mask over? Undo can bring your previous shape back.';
      grid.append(copy, button('Cancel', 'page', 'more'), button('Confirm', 'confirm'));
    }
    const scroll = document.createElement('div'); scroll.className = 'hand-panel-scroll';
    scroll.append(button('↑ Up', 'scroll', '-1'), button('↓ Down', 'scroll', '1')); this.panel.append(scroll);
    const help = document.createElement('p'); help.className = 'hand-panel-help'; help.textContent = 'Hold your index on a button for 0.5 seconds to choose'; this.panel.append(help);
    scroll.hidden = this.body.scrollHeight <= this.body.clientHeight + 2;
  }
  announce(message) { this.feedback.hidden = false; if (this.feedback.textContent !== message) this.feedback.textContent = message; }
  lose() {
    this.selection.cancel(); this.cursor.hidden = true; this.cursor.style.setProperty('--dwell-progress', '0deg'); this.highlight?.classList.remove('hand-hover', 'hand-selected'); this.highlight = null;
    this.feedback.hidden = !this.isOpen;
    if (this.isOpen) this.announce('Hand lost · show your index finger to continue');
  }
  reset() { this.lose(); this.selection.reset(); this.identity.reset(); }
  tick(now) { this.sync(); if (this.lastAt && now - this.lastAt > 300) { this.lose(); this.lastAt = 0; } }
  hit(point, overlay = null) {
    const root = this.isOpen ? this.panel : overlay ?? this.stage;
    if (this.highlight?.isConnected && root.contains(this.highlight) && !this.highlight.disabled && this.visible(this.highlight)) {
      const b = this.highlight.getBoundingClientRect();
      if (point.x >= b.left - 12 && point.x <= b.right + 12 && point.y >= b.top - 12 && point.y <= b.bottom + 12) return this.highlight;
    }
    const targets = [...root.querySelectorAll('button, summary')].filter(target => !target.disabled && this.visible(target));
    return targets.find(target => {
      const b = target.getBoundingClientRect();
      if (this.isOpen && this.body?.contains(target)) {
        const clip = this.body.getBoundingClientRect();
        if (point.y < clip.top || point.y > clip.bottom) return false;
      }
      return point.x >= b.left - 5 && point.x <= b.right + 5 && point.y >= b.top - 5 && point.y <= b.bottom + 5;
    }) ?? null;
  }
  visible(target) { return Boolean(target.getClientRects().length && !target.closest('[hidden], [inert]') && getComputedStyle(target).visibility !== 'hidden'); }
  receive(result, now, { blocked = false, aspect = 1 } = {}) {
    const candidates = (result.landmarks ?? []).map((points, index) => ({ points, index, palm: palmCenter(points), label: result.handedness?.[index]?.[0]?.categoryName ?? '' })).filter(candidate => candidate.palm);
    const hand = this.identity.choose(candidates, now);
    if (!hand) { this.lose(); return { owns: this.isOpen, index: null, missing: candidates.length > 0 }; }
    if (hand.changed) this.selection.reset();
    const point = this.mapPoint(hand.points[8]);
    const tutorial = this.stage.querySelector('#studio-tutorial:not([hidden])');
    const tutorialBounds = tutorial?.getBoundingClientRect();
    const overTutorial = tutorialBounds && point.x >= tutorialBounds.left && point.x <= tutorialBounds.right
      && point.y >= tutorialBounds.top && point.y <= tutorialBounds.bottom;
    const target = this.hit(point, overTutorial ? tutorial : null);
    const fist = closedPalm(hand.points, aspect);
    const distance = (a, b) => Math.hypot((hand.points[a].x - hand.points[b].x) * aspect, hand.points[a].y - hand.points[b].y);
    const open = !fist && distance(4, 8) / Math.max(.025, distance(5, 17), distance(0, 9) * .7) >= .55;
    const key = target && (target.id || `${this.page}:${target.dataset.handAction}:${target.dataset.value ?? ''}`);
    const rect = target?.getBoundingClientRect();
    const bounds = rect && { left: rect.left - 12, right: rect.right + 12, top: rect.top - 12, bottom: rect.bottom + 12 };
    const response = this.selection.update({ point, target, key, bounds, fist, blocked,
      modal: this.isOpen || Boolean(overTutorial && !blocked), now });
    this.lastAt = now;
    this.highlight?.classList.remove('hand-hover', 'hand-selected');
    this.highlight = response.target ?? null;
    this.highlight?.classList.add('hand-hover');
    if (response.phase === 'selected') this.highlight?.classList.add('hand-selected');
    const stageRect = this.stage.getBoundingClientRect();
    this.cursor.style.transform = `translate(${point.x - stageRect.left}px, ${point.y - stageRect.top}px)`;
    this.cursor.dataset.phase = response.phase;
    this.cursor.style.setProperty('--dwell-progress', `${response.progress * 360}deg`);
    // The fingertip stays visible while an edit owns input. Blocking menu
    // selection must not hide the pointer used to trace a cut or pull.
    this.cursor.hidden = false;
    if (response.phase === 'selected') this.announce('Selected · move away to choose again');
    else if (response.target && !blocked) {
      const label = response.target.getAttribute('aria-label') || response.target.textContent.trim();
      this.announce(response.phase === 'point' ? 'Point with your index to choose' : `Hold for 0.5 seconds to select ${label}`);
    } else if (this.isOpen) this.announce('Hold your index on an option for 0.5 seconds');
    else this.feedback.hidden = true;
    if (response.activated?.isConnected && !response.activated.disabled && this.visible(response.activated)) {
      response.activated.click();
      this.announce('Selected · move away to choose again');
    }
    return { owns: response.owns, index: hand.index, needsOpen: !open, changed: hand.changed };
  }
}
