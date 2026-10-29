// One small SVG vocabulary for studio actions. All color comes from the theme.
const paths = {
  paint: 'm15 4 5 5-8 8-5-5zM7 12l5 5M7 17c0 4-4 4-4 4s0-4 4-4',
  erase: 'm4 14 9-10 8 7-9 10H9zM8 10l8 7M12 21h9',
  mask: 'M5 4q7 3 14 0v10q-1 5-7 8-6-3-7-8zM8 10l3 1m5-1-3 1M9 16q3 2 6 0',
  eyes: 'M3 12q4-7 8 0-4 5-8 0Zm10 0q4-7 8 0-4 5-8 0Z',
  more: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  camera: 'M3 7h5l2-3h4l2 3h5v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  pin: 'M8 3h8l-1 6 3 4v2H6v-2l3-4zM12 15v6',
  unpin: 'M8 3h8l-1 6 3 4v2H6v-2l3-4M12 15v6M3 3l18 18',
  undo: 'M9 4 4 9l5 5M4 9h10a5.5 5.5 0 0 1 0 11h-3',
  redo: 'm15 4 5 5-5 5M20 9H10a5.5 5.5 0 0 0 0 11h3',
  close: 'm6 6 12 12M18 6 6 18',
  back: 'm10 5-7 7 7 7M3 12h18',
  next: 'M4 12h16m-7-7 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2c5 0 3-11-6-11ZM7 9h.01M11 6h.01M16 8h.01M6 14h.01',
  hand: 'M7 12V7a1.5 1.5 0 0 1 3 0v4-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 5-2 7-6 7-3 0-5-2-7-5l-3-4q1-2 3 0l2 2',
  pinch: 'M6 20c-4-5-3-10 1-10h5V5a2 2 0 0 1 4 0v7l3-2q3 0 2 3l-3 6q-2 3-7 2M6 10l5 5',
  sound: 'M4 9h4l5-5v16l-5-5H4zM17 8q5 4 0 8M19 4q9 8 0 16',
  muted: 'M4 9h4l5-5v16l-5-5H4zM17 9l5 6m0-6-5 6',
  symmetry: 'M12 3v18M8 5 3 17h5ZM16 5l5 12h-5Z',
  position: 'M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M8 12h8m-4-4v8',
  reset: 'M6 6a8 8 0 1 1-2 9M6 3v6h6',
  pause: 'M8 5v14M16 5v14',
  play: 'm8 4 12 8-12 8z',
  tutorial: 'M3 5h7l2 2 2-2h7v14h-7l-2 2-2-2H3zM12 7v14',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  rough: 'm3 16 3-7 3 6 3-8 3 9 3-6 3 5',
  smooth: 'M3 16q9-16 18 0',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2',
  share: 'M8 12 17 6M8 12l9 6M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  save: 'M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  cursor: 'm5 3 14 10-7 1-3 7z',
  upper: 'M5 5h14v4H5zM7 15h.01M12 15h.01M17 15h.01',
  lower: 'M5 15h14v4H5zM7 7h.01M12 7h.01M17 7h.01',
};

function iconKey(button, label) {
  if (button.matches('.comfort-setup button:not(.comfort-skip)')) return 'camera';
  const { handAction: action, value, tool, selfie, adjust, paintScroll } = button.dataset;
  if (tool) return ({ pinch: 'pull', extrude: 'extrude', paint: 'paint', erase: 'erase' })[tool] || 'mask';
  if (button.id === 'sculpt-undo') return 'undo';
  if (button.id === 'sculpt-redo') return 'redo';
  if (button.id === 'tutorial-next' && /^next\b/i.test(label)) return 'next';
  if (action === 'dock-pin') return button.getAttribute('aria-pressed') === 'true' ? 'unpin' : 'pin';
  if (action === 'page') return ({ more: /cancel/i.test(label) ? 'close' : 'back', themes: 'palette', controls: 'hand', masks: 'mask', eyes: 'eyes', colors: 'palette', custom: 'palette' })[value];
  if (action === 'sound') return /off/i.test(label) ? 'muted' : 'sound';
  if (action === 'control-mode') return value === 'palm' ? 'hand' : 'pinch';
  if (action === 'pause') return /resume/i.test(label) ? 'play' : 'pause';
  if (action === 'scroll' || paintScroll) return Number(value ?? paintScroll) < 0 ? 'upper' : 'lower';
  if (action === 'mask-page') return Number(value) < 0 ? 'undo' : 'redo';
  if (action === 'smoothness-step') return Number(value) < 0 ? 'rough' : 'smooth';
  if (action === 'adjust' || adjust) return Number((value ?? adjust).split(':')[1]) < 0 ? 'minus' : 'plus';
  if (selfie) return ({ close: 'close', share: 'share', download: 'save', copy: 'copy', retake: 'camera' })[selfie];
  const actions = { try: 'mask', selfie: 'camera', more: 'more', close: 'close', 'try-done': 'back', symmetry: 'symmetry', position: 'position', reset: 'reset', remove: 'erase', confirm: 'check', 'custom-apply': 'check', 'camera-on': 'camera', 'camera-off': 'camera', tutorial: 'tutorial', 'tracking-report': 'report', dwell: 'clock' };
  if (actions[action]) return actions[action];
  if (button.id === 'paint-collapse') return button.getAttribute('aria-expanded') === 'true' ? 'minus' : 'palette';
  if (/cursor/i.test(label)) return 'cursor';
  if (/close|cancel|skip/i.test(label)) return 'close';
  if (/back|previous/i.test(label)) return 'back';
  if (/recipe|again|retake/i.test(label)) return 'reset';
  if (/try it|wear/i.test(label)) return 'mask';
  if (/camera|ready/i.test(label)) return 'camera';
  return 'check';
}

function makeIcon(document, key) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('studio-button-icon');
  svg.setAttribute('viewBox', key === 'pull' || key === 'extrude' ? '0 0 48 48' : '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (key === 'pull' || key === 'extrude') {
    svg.classList.add('studio-clay-icon');
    // Rounded pulled clay and a tapered extrusion, readable at toolbar size.
    const dome = key === 'pull'
      ? 'M5 36C9 33 13 34 15 29L16 17C17 6 31 6 32 17L33 29C35 34 39 33 43 36Q24 46 5 36Z'
      : 'M5 36C12 33 15 32 18 22L22 11Q24 5 27 12L31 25C34 33 39 33 43 36Q24 46 5 36Z';
    svg.innerHTML = `<ellipse cx="24" cy="37" rx="20" ry="6" fill="currentColor" opacity=".12" stroke="none"/><path d="${dome}" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.6"/><path d="${dome}" fill="none" stroke="currentColor" stroke-width=".6" opacity=".5" transform="translate(-.7,-.8)"/><path d="M9 36Q24 42 39 36" fill="none" stroke="currentColor" opacity=".45" stroke-width="1.2"/>`;
  } else {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[key] || paths.check); svg.append(path);
  }
  return svg;
}

// Keep real previews (eyes, masks, colors and theme palettes); hide their captions.
const previewButton = '.studio-theme-card,.hand-mask-card,.hand-eye-card,.hand-color,.clay-swatch,.shape-option,[data-paint-color],[data-mask-base],[data-eye-base]';
const previewNode = 'svg,.studio-theme-palette,.hand-eye-card > span:has(svg),[aria-hidden="true"][style*="paint-color"]';

export class StudioIcons {
  constructor(stage) {
    this.stage = stage; this.document = stage.ownerDocument;
    this.tooltip = this.document.createElement('div');
    this.tooltip.id = 'studio-button-tooltip'; this.tooltip.className = 'studio-button-tooltip';
    this.tooltip.setAttribute('role', 'tooltip'); this.tooltip.hidden = true;
    this.document.body.append(this.tooltip);
    stage.querySelectorAll('button').forEach(button => this.decorate(button));
    this.observer = new MutationObserver(records => {
      const changed = new Set();
      for (const record of records) {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (record.type !== 'attributes' || record.attributeName !== 'class') {
          const button = element?.closest('button'); if (button) changed.add(button);
          for (const node of record.addedNodes ?? []) if (node.nodeType === 1) {
            if (node.matches('button')) changed.add(node);
            node.querySelectorAll('button').forEach(button => changed.add(button));
          }
        }
      }
      // Do not observe our own label wrapping and SVG updates.
      this.observer.disconnect(); changed.forEach(button => this.decorate(button)); this.observe();
      this.refreshTooltip();
    });
    this.observe();
    stage.addEventListener('pointerover', event => { if (event.pointerType !== 'touch') { this.hover = event.target.closest('button'); this.refreshTooltip(); } });
    stage.addEventListener('pointerout', event => { this.hover = event.relatedTarget?.closest?.('button'); this.refreshTooltip(); });
    stage.addEventListener('focusin', event => { if (event.target.matches('button:focus-visible')) this.hover = null; this.refreshTooltip(); });
    stage.addEventListener('focusout', () => queueMicrotask(() => this.refreshTooltip()));
    stage.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') {
        this.hover = null; this.touch = event.target.closest('button'); this.refreshTooltip();
        clearTimeout(this.touchTimer); this.touchTimer = setTimeout(() => { this.touch = null; this.refreshTooltip(); }, 1800);
      }
    });
    this.document.addEventListener('keydown', event => { if (event.key === 'Escape') { this.dismissed = this.target; this.hideTooltip(); } });
    stage.addEventListener('scroll', () => this.refreshTooltip(), true);
    window.addEventListener('resize', () => this.refreshTooltip());
  }

  observe() { this.observer.observe(this.stage, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'aria-pressed', 'aria-expanded', 'class', 'hidden'] }); }

  decorate(button) {
    if (!button.isConnected) return;
    // Existing action code can still read/update the original text and nodes.
    const text = button.textContent.trim().replace(/^[↶↷↑↓←→＋−]\s*/, '').replace(/\s+/g, ' ');
    const existingName = button.getAttribute('aria-label');
    const generatedName = button.dataset.studioGeneratedName;
    const label = (!existingName || existingName === generatedName) && text ? text : existingName || text;
    if (!label) return;
    if (existingName !== label) { button.setAttribute('aria-label', label); button.dataset.studioGeneratedName = label; }
    if (!button.classList.contains('studio-icon-button')) button.classList.add('studio-icon-button');
    const preview = button.matches(previewButton);
    for (const node of [...button.childNodes]) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        const span = this.document.createElement('span'); span.className = 'studio-button-label'; node.replaceWith(span); span.append(node);
      } else if (node.nodeType === 1 && !node.matches('.studio-button-icon')) {
        if (preview && node.matches(previewNode)) continue;
        if (node.tagName.toLowerCase() === 'svg') node.remove();
        else if (!node.classList.contains('studio-button-label')) node.classList.add('studio-button-label');
      }
    }
    const key = iconKey(button, label);
    if (!preview && (!button.querySelector('.studio-button-icon') || button.dataset.studioIconKey !== key)) {
      button.querySelector('.studio-button-icon')?.remove(); button.prepend(makeIcon(this.document, key)); button.dataset.studioIconKey = key;
    }
    // The custom tooltip replaces native titles, avoiding duplicate popups.
    button.removeAttribute('title');
  }

  refreshTooltip() {
    const focused = this.document.activeElement;
    const visible = target => target && this.stage.contains(target) && target.isConnected && !target.closest('[hidden],[inert]') && target.getClientRects().length && getComputedStyle(target).visibility !== 'hidden';
    const target = [this.hover, this.touch, this.stage.querySelector('button.hand-hover'), focused?.matches('button:focus-visible') ? focused : null].find(visible);
    if (this.dismissed && target !== this.dismissed) this.dismissed = null;
    if (!target || target === this.dismissed) { this.hideTooltip(); return; }
    if (this.target !== target) { this.hideTooltip(); this.target = target; }
    const description = target.classList.contains('studio-theme-card') ? target.querySelector('.studio-theme-description')?.textContent : '';
    const text = [target.getAttribute('aria-label'), description].filter(Boolean).join(' · ');
    if (this.tooltip.textContent !== text) this.tooltip.textContent = text;
    this.tooltip.hidden = false;
    const ids = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); ids.add(this.tooltip.id);
    target.setAttribute('aria-describedby', [...ids].join(' '));
    const rect = target.getBoundingClientRect(), tip = this.tooltip.getBoundingClientRect();
    const beside = target.closest('.hand-toolbar,#studio-tools-tab');
    let x = beside ? rect.right + 12 : rect.left + (rect.width - tip.width) / 2;
    let y = beside ? rect.top + (rect.height - tip.height) / 2 : rect.bottom + 10;
    if (y + tip.height > window.innerHeight - 8) y = rect.top - tip.height - 10;
    this.tooltip.style.left = `${Math.max(8, Math.min(x, window.innerWidth - tip.width - 8))}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(y, window.innerHeight - tip.height - 8))}px`;
  }

  hideTooltip() {
    if (this.target) {
      const ids = (this.target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== this.tooltip.id);
      if (ids.length) this.target.setAttribute('aria-describedby', ids.join(' ')); else this.target.removeAttribute('aria-describedby');
    }
    this.target = null; this.tooltip.hidden = true;
  }
}
