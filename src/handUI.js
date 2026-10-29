import { DockVisibility } from './dockVisibility.js';
import { StudioIcons } from './studioIcons.js';
import { STUDIO_THEMES, savedStudioTheme, applyStudioTheme } from './studioThemes.js';
import { PalmControl } from './palmControl.js';
import { trackingTrace } from './trackingTrace.js';
import { HandSelection, ControlHand } from './handSelection.js';
import { palmCenter } from './twoHandScale.js';
import { closedPalm } from './palmMove.js';
import { MASK_SHAPES, EYE_SHAPES, eyePreview } from './clayShapes.js';
import { HandMotion } from './handMotion.js';
import { PinchGesture } from './pinchGesture.js';
import { CLAY_COLORS } from './clayAppearance.js';

export const HAND_UI_SAMPLE_AGE_MS = 500;
const cursorGraceMs = 650;

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
    this.selection = new HandSelection();
    this.selection.dwellMs = 800;
    try { const dwell=Number(localStorage.getItem('clayplay-dwell')); if([500,800,1200].includes(dwell))this.selection.dwellMs=dwell; } catch {} this.identity = new ControlHand({ graceMs: cursorGraceMs });
    this.motion = new HandMotion({ staleMs: HAND_UI_SAMPLE_AGE_MS });
    this.theme=savedStudioTheme();applyStudioTheme(this.theme);
    this.page = 'more'; this.maskPage = 0;
    const sizeControl=document.querySelector('.size-control');
    sizeControl.classList.add('stage-size-control');
    sizeControl.setAttribute('aria-label','Deformation tool size');
    sizeControl.querySelector('label').textContent='TOOL SIZE';
    sizeControl.querySelector('#size-context').hidden=true;
    sizeControl.addEventListener('pointerdown',event=>event.stopPropagation());
    stage.append(sizeControl);
    this.custom = [20, 55, 60]; this.lastAt = null; this.gapAt = null;
    this.dock = document.createElement('nav'); this.dock.id = 'hand-toolbar';
    this.dock.className = 'hand-toolbar'; this.dock.setAttribute('aria-label', 'Mask studio tools');
    for (const id of ['tool-pinch', 'tool-extrude', 'tool-paint', 'tool-erase']) this.dock.append(document.getElementById(id));
    this.tryIt = button('Try it', 'try'); this.tryIt.id = 'hand-try';
    this.tryIt.setAttribute('aria-label', 'Try it: wear your mask'); this.dock.append(this.tryIt);
    this.selfieButton=button('Selfie','selfie');this.selfieButton.id='hand-selfie';this.selfieButton.setAttribute('aria-label','Take a mask selfie');this.dock.append(this.selfieButton);
    for (const id of ['sculpt-undo', 'sculpt-redo']) this.dock.append(document.getElementById(id));
    this.more = button('More', 'more'); this.more.id = 'hand-more';
    this.more.setAttribute('aria-expanded', 'false'); this.more.setAttribute('aria-controls', 'hand-panel');
    this.dock.append(this.more); stage.append(this.dock);
    const icons = {
      'tool-pinch':'M5 16h5l4-8 3 2-3 9H5M5 12v8M14 5l3-3m1 5h4',
      'tool-extrude':'M3 19h18M6 19v-5l6-7 6 7v5M12 7V2m-3 3 3-3 3 3',
      'tool-paint':'m14 4 6 6-8 8H6v-6zM5 18c0 3-3 3-3 3s0-3 3-3',
      'tool-erase':'m4 15 9-11 8 7-9 10H9zM8 11l8 7M12 21h9',
      'hand-selfie':'M4 7h4l2-3h4l2 3h4v13H4zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
      'hand-try':'M5 4h14v12l-7 5-7-5zM8 10h2m4 0h2M9 15q3 3 6 0',
      'sculpt-undo':'M9 5 3 10l6 5M3 10h11a6 6 0 0 1 0 12',
      'sculpt-redo':'m15 5 6 5-6 5M21 10H10a6 6 0 0 0 0 12',
      'hand-more':'M5 12h.01M12 12h.01M19 12h.01'
    };
    for (const target of this.dock.children) {
      const label = document.createElement('span'); label.className = 'tool-label'; label.textContent = target.textContent.replace(/^[↶↷]\s*/, '');
      target.replaceChildren(label);
      const icon = document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('aria-hidden','true');
      const path = document.createElementNS(icon.namespaceURI,'path'); path.setAttribute('d',icons[target.id]); icon.append(path); target.prepend(icon);
    }
    this.historyDock=document.createElement('nav');this.historyDock.className='studio-history-dock';this.historyDock.setAttribute('aria-label','Undo and redo');
    for(const id of ['sculpt-undo','sculpt-redo'])this.historyDock.append(document.getElementById(id));stage.append(this.historyDock);
    this.pinTools=button('Pinned','dock-pin');this.pinTools.id='dock-pin';this.dock.append(this.pinTools);
    let pinned=true;try{pinned=localStorage.getItem('clayplay-tools-pinned')!=='false';}catch{}
    this.dockVisibility=new DockVisibility({pinned,now:performance.now()});
    this.toolsTab=button('Tools','dock-open');this.toolsTab.id='studio-tools-tab';this.toolsTab.setAttribute('aria-controls','hand-toolbar');stage.append(this.toolsTab);
    const brand=document.createElement('div');brand.className='studio-brand';brand.setAttribute('aria-label','Mask Studio — Create, shape, express');
    brand.innerHTML='<svg viewBox="0 0 48 56" aria-hidden="true"><defs><linearGradient id="studio-brand-gradient" x2="1" y2="1"><stop stop-color="#794cff"/><stop offset=".55" stop-color="#ea19ee"/><stop offset="1" stop-color="#ffa15a"/></linearGradient></defs><path fill="url(#studio-brand-gradient)" d="M4 5Q24 13 44 5L41 36Q36 50 24 53Q12 50 7 36Z"/><path fill="#170b35" d="m10 20 12 4-3 6-8-3Zm28 0-12 4 3 6 8-3ZM18 39q6 4 12 0-6 9-12 0"/></svg><div><strong>Mask<span>Studio</span></strong><small>Create · Shape · Express</small></div>';
    const art=document.createElement('div');art.className='studio-corner-art';art.setAttribute('aria-hidden','true');art.innerHTML='<i></i><i></i><i></i><i></i>';stage.append(art,brand);
    this.mouseNearDock=false;this.keyboardDock=false;
    stage.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;this.mouseNearDock=this.nearDock({x:event.clientX,y:event.clientY});this.updateDock(performance.now());});
    stage.addEventListener('pointerleave',()=>{this.mouseNearDock=false;});
    stage.addEventListener('pointerdown',event=>{this.keyboardDock=false;this.mouseEditing=!event.target.closest('button,summary,input,select,a');});
    window.addEventListener('pointerup',()=>{this.mouseEditing=false;});window.addEventListener('pointercancel',()=>{this.mouseEditing=false;});
    document.addEventListener('keydown',event=>{if(event.key==='Tab')this.keyboardDock=true;});
    stage.addEventListener('click',event=>{if(event.detail>0 && performance.now()<(this.dockRevealUntil ?? 0) && this.dock.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
    this.toolsTab.addEventListener('focus',()=>{if(this.keyboardDock){this.dockVisibility.reveal(performance.now());this.updateDock(performance.now());this.dock.querySelector('button:not(:disabled)')?.focus({preventScroll:true});}});
    this.selfieButton.classList.add('stage-selfie');
    this.selfieButton.addEventListener('pointerdown',event=>event.stopPropagation());
    stage.append(this.selfieButton);
    this.panel = document.createElement('section'); this.panel.id = 'hand-panel'; this.panel.className = 'hand-panel'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Studio options'); stage.append(this.panel);
    this.done = button('Back to creating', 'try-done'); this.done.id = 'hand-try-done'; this.done.className = 'hand-try-done'; this.done.hidden = true; stage.append(this.done);
    this.cursor = document.createElement('div'); this.cursor.className = 'hand-ui-cursor'; this.cursor.hidden = true; this.cursor.setAttribute('aria-hidden', 'true'); stage.append(this.cursor);
    const loading = document.createElement('span'); loading.className = 'studio-loading-icon hand-cursor-loading'; loading.textContent = 'Ⅱ'; this.cursor.append(loading);
    this.feedback = document.createElement('div'); this.feedback.id = 'hand-feedback'; this.feedback.className = 'hand-feedback'; this.feedback.hidden = true; this.feedback.setAttribute('role', 'status'); stage.append(this.feedback);
    stage.classList.add('hand-ui-ready');
    stage.addEventListener('click', event => {
      const target = event.target.closest('[data-hand-action]');
      if (target && !target.disabled) this.act(target.dataset.handAction, target.dataset.value);
    });
    window.addEventListener('resize', () => { this.signature = null; });
    this.sync();this.updateDock(performance.now());
    this.icons = new StudioIcons(stage);
  }
  get isOpen() { return !this.panel.hidden; }
  open(page = 'more') {
    this.dockVisibility?.reveal(performance.now());
    this.page = page; this.panel.hidden = false; this.more.setAttribute('aria-expanded', 'true');
    this.onPause(); this.selection.cancel(); this.signature = null; this.sync();
  }
  close() {
    this.panel.hidden = true; this.more.setAttribute('aria-expanded', 'false');
    this.onPause(); this.selection.cancel(); this.more.focus({ preventScroll: true });
  }
  act(action, value) {
    const state = this.getState();
    if(action==='dock-open') {this.dockVisibility.reveal(performance.now());this.updateDock(performance.now());return;}
    if(action==='dock-pin') {
      this.dockVisibility.pinned=!this.dockVisibility.pinned;this.dockVisibility.reveal(performance.now());
      try{localStorage.setItem('clayplay-tools-pinned',String(this.dockVisibility.pinned));}catch{}
      this.updateDock(performance.now());return;
    }
    if(action === 'theme') {
      const scrollTop=this.body?.scrollTop ?? 0;
      if(applyStudioTheme(value)) {
        this.theme=value;this.signature=null;this.sync();
        if(this.page==='themes' && this.body) {
          this.body.scrollTop=scrollTop;
          this.body.querySelector(`[data-hand-action="theme"][data-value="${value}"]`)?.focus({preventScroll:true});
        }
        this.announce(`${STUDIO_THEMES.find(t=>t.id===value).name} theme selected`);
      }
      return;
    }
    if(action === 'dwell') {this.selection.dwellMs=Number(value);this.selection.cancel();try{localStorage.setItem('clayplay-dwell',value);}catch{} this.signature=null;this.sync();return;}
    if (action === 'more') { if (this.isOpen) this.close(); else this.open(); return; }
    if (action === 'close') { this.close(); return; }
    if (action === 'page') { this.open(value); return; }
    if (action === 'mask-page') { this.maskPage += Number(value); this.signature = null; this.sync(); return; }
    if (action === 'scroll') { this.body.scrollBy({ top: Number(value) * 180, behavior: 'smooth' }); return; }
    if (action === 'smoothness-step') {
      this.onAction('smoothness', Math.max(0, Math.min(100, state.smoothness + Number(value))));
      this.sync(); return;
    }
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
    if (state.busy && ['select-mask', 'add-mask', 'eye-shape', 'try', 'position'].includes(action)) { this.announce('Finishing your edit · try again in a moment'); return; }
    this.onAction(action, value);
    if (['select-mask', 'try', 'pause'].includes(action)) this.close();
    this.signature = null; this.sync();
  }
  sync() {
    const s = this.getState(); this.controlMode=s.controlMode ?? 'palm'; this.done.hidden = !s.trying;
    this.tryIt.disabled = s.busy || s.selfieBusy;
    this.selfieButton.disabled=s.busy || s.selfieBusy;
    this.tryIt.setAttribute('aria-pressed', String(s.trying));
    // Keep the slider and dwell targets mounted while the finish changes.
    // Replacing the panel here would interrupt an ongoing pointer drag.
    const { smoothness, ...panelState } = s;
    const signature = JSON.stringify([this.page, this.maskPage, this.custom, this.theme, panelState]);
    if (!this.isOpen) return;
    if (signature === this.signature) { this.syncFinish(smoothness); return; }
    this.signature = signature;
    this.finishControl = null;
    const header = document.createElement('header');
    header.append(button(this.page === 'more' ? 'Close' : 'Back', this.page === 'more' ? 'close' : 'page', 'more'));
    const title = document.createElement('strong'); title.textContent = ({themes:'Studio themes',controls:'Hand controls',more:'Studio options',masks:'Your masks',eyes:'Mask eyes',colors:'Color & finish',custom:'Mix your color',confirm:'Are you sure?'})[this.page];
    header.append(title);
    if (this.page !== 'more') header.append(button('Close', 'close'));
    const grid = document.createElement('div'); grid.className = 'hand-panel-grid';
    this.body = document.createElement('div'); this.body.className = 'hand-panel-body'; this.body.append(grid);
    this.panel.replaceChildren(header, this.body);
    if (this.page === 'more') {
      grid.classList.add('hand-options');
      grid.append(button('Studio themes', 'page', 'themes'), button('Hand controls', 'page', 'controls'));
      grid.append(button('Masks', 'page', 'masks'), button('Mask eyes', 'page', 'eyes'), button('Color & finish', 'page', 'colors'));
      const symmetry = button(`Symmetry ${s.symmetry ? 'On' : 'Off'}`, 'symmetry'); symmetry.setAttribute('aria-pressed', String(s.symmetry)); symmetry.disabled = s.trying;
      symmetry.classList.add('hand-symmetry');
      const symmetryIcon = document.querySelector('#vertical-symmetry svg')?.cloneNode(true);
      if (symmetryIcon) symmetry.prepend(symmetryIcon);
      const position = button('Reset position', 'position'); position.disabled = s.positionResetDisabled || s.trying;
      const reset = button('Reset mask', 'reset'); reset.disabled = !s.edited || s.busy || s.trying;
      const pause = button(s.paused ? 'Resume creating' : 'Pause editing', 'pause'); pause.disabled = s.trying;
      const camera = button(s.cameraOn ? 'Turn camera off' : 'Set up camera', s.cameraOn ? 'camera-off' : 'camera-on');
      const tutorial = button('Replay tutorial', 'tutorial'); tutorial.disabled = s.busy;
      const sound = button(`Sounds ${s.sound ? 'On' : 'Off'}`, 'sound'); sound.setAttribute('aria-pressed', String(s.sound));
      grid.append(sound, symmetry, position, reset, pause, camera, tutorial);
      if(s.trackingIssue)grid.append(button('Copy issue report','tracking-report'));
    } else if (this.page === 'themes') {
      grid.classList.add('studio-themes');
      const note=document.createElement('p');note.className='hand-panel-caption';note.textContent='Try a different mood. Your choice is remembered; mask and paint colors stay yours.';grid.append(note);
      for(const theme of STUDIO_THEMES) {
        const choice=button('', 'theme', theme.id);choice.className='studio-theme-card';
        choice.setAttribute('aria-label',theme.name);choice.setAttribute('aria-pressed',String(this.theme===theme.id));
        const palette=document.createElement('span');palette.className='studio-theme-palette';palette.setAttribute('aria-hidden','true');
        for(const color of theme.colors){const chip=document.createElement('i');chip.style.background=color;palette.append(chip);}
        const name=document.createElement('strong');name.textContent=theme.name;
        const detail=document.createElement('span');detail.className='studio-theme-description';detail.textContent=theme.description;
        const selected=document.createElement('span');selected.className='studio-theme-selected';selected.textContent=this.theme===theme.id?'✓ Selected':'Try theme';
        choice.append(palette,name,detail,selected);grid.append(choice);
      }
    } else if (this.page === 'controls') {
      const note=document.createElement('p');note.className='hand-panel-caption';
      note.textContent='Try both and choose what feels natural. Your choice is remembered.';grid.append(note);
      for(const [mode,label]of [['index','Index & pinch'],['palm','Palm & grip']]) {
        const choice=button(label,'control-mode',mode);choice.setAttribute('aria-pressed',String(s.controlMode===mode));grid.append(choice);
      }
      const timing=document.createElement('p');timing.className='hand-panel-caption';timing.textContent='Button selection speed';grid.append(timing);
      for(const [ms,label] of [[500,'Quick · 0.5s'],[800,'Relaxed · 0.8s'],[1200,'Steady · 1.2s']]) {const option=button(label,'dwell',String(ms));option.setAttribute('aria-pressed',String((this.selection.dwellMs ?? 800)===ms));grid.append(option);}
      const help=document.createElement('p');help.className='hand-panel-caption';
      help.textContent='Palm: move your palm to aim, close gently to apply, open to release. Hover with an open hand to choose buttons; close and slide to adjust sliders. Keep your wrist visible. One closed hand applies a tool; two fists resize. Use Index control for the whole-mask move gesture.';grid.append(help);
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
        const add = button(`＋ ${details.label}`, 'add-mask', shape);
        add.className = 'hand-mask-card hand-starter-mask';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
        const outline = document.createElementNS(icon.namespaceURI, 'path');
        outline.setAttribute('d', details.icon); icon.append(outline);
        for (const cx of ['9.2', '14.8']) {
          const eye = document.createElementNS(icon.namespaceURI, 'ellipse');
          eye.setAttribute('cx', cx); eye.setAttribute('cy', '10');
          eye.setAttribute('rx', '1.5'); eye.setAttribute('ry', '.7');
          icon.append(eye);
        }
        add.prepend(icon);
        add.disabled = s.busy || s.masks.length >= 8; grid.append(add);
      }
      const remove = button('Remove selected', 'remove'); remove.disabled = s.busy || s.masks.length < 2; grid.append(remove);
    } else if (this.page === 'eyes') {
      const caption = document.createElement('p'); caption.className = 'hand-panel-caption';
      caption.textContent = 'Choose openings for your selected mask. Undo brings the previous eyes back.';
      grid.append(caption);
      for (const [key, details] of Object.entries(EYE_SHAPES)) {
        const option = button(details.label, 'eye-shape', key);
        option.className = 'hand-eye-card'; option.disabled = s.busy;
        option.setAttribute('aria-pressed', String((s.eyeShape ?? 'oval') === key));
        const preview = document.createElement('span'); preview.innerHTML = eyePreview(key);
        option.prepend(preview); grid.append(option);
      }
    } else if (this.page === 'colors') {
      grid.classList.add('hand-colors');
      for (const [name, hex] of CLAY_COLORS) {
        const swatch = button(name, 'color', hex); swatch.style.setProperty('--swatch', hex); swatch.className = 'hand-color';
        swatch.setAttribute('aria-pressed', String(s.color === hex)); grid.append(swatch);
      }
      const custom = button('Mix a custom color', 'page', 'custom'); custom.className = 'hand-custom-color'; grid.append(custom);
      const finish = document.createElement('section'); finish.className = 'hand-finish'; finish.setAttribute('aria-label', 'Surface finish');
      const heading = document.createElement('div'); heading.className = 'hand-finish-heading';
      const label = document.createElement('label'); label.htmlFor = 'mask-smoothness'; label.textContent = 'Surface finish';
      const output = document.createElement('output'); output.htmlFor = 'mask-smoothness';
      heading.append(label, output);
      const slider = document.createElement('input'); slider.type = 'range'; slider.id = 'mask-smoothness';
      slider.min = '0'; slider.max = '100'; slider.step = '1';
      slider.addEventListener('input', () => { this.onAction('smoothness', Number(slider.value)); this.sync(); });
      const endpoints = document.createElement('div'); endpoints.className = 'hand-finish-endpoints';
      const rough = document.createElement('span'), smooth = document.createElement('span'); rough.textContent = 'Rough'; smooth.textContent = 'Smooth'; endpoints.append(rough, smooth);
      const steps = document.createElement('div'); steps.className = 'hand-finish-steps';
      const rougher = button('− Rougher', 'smoothness-step', '-10'), smoother = button('＋ Smoother', 'smoothness-step', '10');
      steps.append(rougher, smoother); finish.append(heading, slider, endpoints, steps); grid.append(finish);
      this.finishControl = { slider, output, rougher, smoother }; this.syncFinish(smoothness);
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
    const help = document.createElement('p'); help.className = 'hand-panel-help'; help.textContent = this.controlMode === 'palm' ? 'Hold your open palm on a button until the ring fills' : 'Hold your index on a button until the ring fills'; this.panel.append(help);
    scroll.hidden = this.body.scrollHeight <= this.body.clientHeight + 2;
  }
  syncFinish(value) {
    if (!this.finishControl) return;
    const { slider, output, rougher, smoother } = this.finishControl;
    slider.value = String(value);
    slider.setAttribute('aria-valuetext', `${value}% smooth`);
    output.value = `${value}% smooth`;
    rougher.disabled = value <= 0; smoother.disabled = value >= 100;
  }
  announce(message) { this.feedback.hidden = false; if (this.feedback.textContent !== message) this.feedback.textContent = message; }
  lose() {
    this.sizeDrag=null;this.sizePinch?.reset();this.palmInput?.reset();this.palmPointer=null;
    this.lastAt = null; this.gapAt = null;
    this.motion.reset();
    this.selection.cancel(); this.cursor.hidden = true; this.cursor.style.setProperty('--dwell-progress', '0deg'); this.highlight?.classList.remove('hand-hover', 'hand-selected'); this.highlight = null;
    this.feedback.hidden = !this.isOpen;
    if (this.isOpen) this.announce(this.controlMode === 'palm' ? 'Hand lost · show your open palm to continue' : 'Hand lost · show your index finger to continue');
  }
  reset() { this.lose(); this.selection.reset(); this.identity.reset(); }
  suspend(now) {
    this.cursor.dataset.gesture='paused';
    this.sizeDrag=null;this.sizePinch?.reset();this.palmInput?.lose();
    if (this.lastAt === null || now - this.lastAt > cursorGraceMs) { this.lose(); return; }
    this.gapAt ??= now;
    this.selection.pause(now);
    // Keep the last painted cursor and highlight. Never extrapolate a missing
    // hand or advance its countdown; hard shutdown still calls lose/reset.
  }
  tick(now) {
    this.sync();
    this.updateDock(now);
    if (this.lastAt !== null && (now - this.lastAt > 300
      || (this.motion.time !== null && now - this.motion.time >= HAND_UI_SAMPLE_AGE_MS))) this.suspend(now);
    if (!this.cursor.hidden && this.gapAt === null) this.drawCursor(now);
  }
  nearDock(point) {
    const stage=this.stage.getBoundingClientRect(),bounds=this.dock.getBoundingClientRect();
    return point.x>=stage.left && point.x<=stage.left+145 && point.y>=bounds.top-35 && point.y<=bounds.bottom+35;
  }
  recordDockHand(point,now,allowed) {
    if(!this.dockVisibility)return;
    this.handDockNear=allowed && this.nearDock(point);this.handDockAt=now;
    this.updateDock(now,!allowed);
  }
  updateDock(now,inputBlocked=false) {
    if(!this.dockVisibility)return;
    const state=this.getState();
    const handNear=this.handDockNear && now-this.handDockAt<250;
    const focused=this.keyboardDock && (this.dock.contains(document.activeElement)||this.toolsTab===document.activeElement);
    const hold=this.isOpen || focused || Boolean(this.sizeDrag) || Boolean(this.highlight && this.dock.contains(this.highlight) && this.selection.hover);
    const wasExpanded=this.dockVisibility.expanded;
    const expanded=this.dockVisibility.update({now,near:this.mouseNearDock||handNear,hold,blocked:inputBlocked||this.mouseEditing||state.busy});
    if(expanded && !wasExpanded)this.dockRevealUntil=now+350;
    this.stage.classList.toggle('tools-collapsed',!expanded);
    this.dock.inert=!expanded;this.dock.setAttribute('aria-hidden',String(!expanded));
    this.toolsTab.setAttribute('aria-expanded',String(expanded));this.toolsTab.hidden=expanded;
    if(this.pinTools.getAttribute('aria-pressed')!==String(this.dockVisibility.pinned))this.pinTools.setAttribute('aria-pressed',String(this.dockVisibility.pinned));
    const pinLabel=this.dockVisibility.pinned?'Unpin tools':'Pin tools';
    if(this.pinTools.textContent!==pinLabel)this.pinTools.textContent=pinLabel;
    const pinDescription=this.dockVisibility.pinned?'Unpin tools to enable auto-hide':'Pin tools to keep them visible';
    if(this.pinTools.getAttribute('aria-label')!==pinDescription)this.pinTools.setAttribute('aria-label',pinDescription);
    const active=this.dock.querySelector('[data-tool].is-active');
    if(active && this.toolsTab.dataset.tool!==active.dataset.tool) {
      this.toolsTab.dataset.tool=active.dataset.tool;
      this.toolsTab.replaceChildren(active.querySelector('svg').cloneNode(true));
      const label=document.createElement('span');label.textContent=active.querySelector('.tool-label').textContent;this.toolsTab.append(label);
      const hint=document.createElement('small');hint.textContent='Tools ›';this.toolsTab.append(hint);
      this.toolsTab.setAttribute('aria-label',`Show tools · ${label.textContent} selected`);
    }
  }
  drawCursor(now) {
    const points = this.motion.sample(now);
    if (!points) return;
    const point = this.mapPoint(this.controlMode==='palm' && this.palmPointer ? this.palmPointer : points[8]), stageRect = this.stage.getBoundingClientRect();
    this.cursor.style.transform = `translate(${point.x - stageRect.left}px, ${point.y - stageRect.top}px)`;
  }
  hit(point, overlay = null) {
    const root = overlay ?? (this.isOpen ? this.panel : this.stage);
    if (this.highlight?.isConnected && root.contains(this.highlight) && !this.highlight.disabled && this.visible(this.highlight)) {
      const b = this.highlight.getBoundingClientRect();
      if (point.x >= b.left - 12 && point.x <= b.right + 12 && point.y >= b.top - 12 && point.y <= b.bottom + 12) return this.highlight;
    }
    const targets = [...root.querySelectorAll('button, summary, #tool-size, input[data-hand-range]')].filter(target => !target.disabled && this.visible(target));
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
  receive(result, now, { blocked = false, aspect = 1, sampleAt = now } = {}) {
    if (now - sampleAt >= HAND_UI_SAMPLE_AGE_MS) {
      this.suspend(now); return { owns: this.isOpen || Boolean(this.selection.hover), index: null, missing: true };
    }
    const candidates = (result.landmarks ?? []).map((points, index) => ({ points, index, palm: palmCenter(points), label: result.handedness?.[index]?.[0]?.categoryName ?? '' })).filter(candidate => candidate.palm);
    const hand = this.identity.choose(candidates, now);
    if (!hand) {
      this.suspend(now);
      return { owns: this.isOpen || Boolean(this.selection.hover), index: null, missing: !this.cursor.hidden || candidates.length > 0 };
    }
    if (hand.changed) { this.selection.reset(); this.motion.reset();this.sizeDrag=null;this.sizePinch?.reset();this.palmInput?.reset(); }
    const measured = this.motion.update(hand.points, sampleAt, now);
    if (!measured) { this.suspend(now); return { owns: this.isOpen, index: null, missing: true }; }
    // Dwell and activation only run on fresh measurements, never predictions.
    const palmMode=this.controlMode==='palm';
    this.palmInput ??=new PalmControl();
    const palm=palmMode ? this.palmInput.update(hand.points,sampleAt,aspect) : null;
    if(palmMode)trackingTrace.record('ui-palm',{...this.palmInput.diagnostic,phase:palm.phase,valid:palm.valid,held:palm.held});
    if(palmMode && (!palm.valid || !palm.point)) {
      this.selection.pause(now);this.sizeDrag=null;
      return {owns:this.isOpen,index:hand.index,needsOpen:!palm.held,missing:palm.phase==='lost',changed:hand.changed};
    }
    if(palmMode)this.palmPointer=palm.point;
    const point = this.mapPoint(palmMode ? palm.point : measured[8]);
    const tutorial = this.stage.querySelector('#selfie-preview:not([hidden]), #mask-shape-picker:not([hidden]), #studio-tutorial:not([hidden])');
    const tutorialBounds = tutorial?.getBoundingClientRect();
    const overTutorial = tutorialBounds && point.x >= tutorialBounds.left && point.x <= tutorialBounds.right
      && point.y >= tutorialBounds.top && point.y <= tutorialBounds.bottom;
    let target = this.hit(point, overTutorial ? tutorial : null);
    const fist = palmMode ? !palm.open : closedPalm(hand.points, aspect);
    const distance = (a, b) => Math.hypot((hand.points[a].x - hand.points[b].x) * aspect, hand.points[a].y - hand.points[b].y);
    const open = palmMode ? palm.open : !fist && distance(4, 8) / Math.max(.025, distance(5, 17), distance(0, 9) * .7) >= .55;
    this.sizePinch ??=new PinchGesture();
    const held=palmMode ? palm.held : this.sizePinch.update(hand.points,sampleAt,aspect);
    this.cursor.dataset.gesture=held?'held':open?'open':'waiting';
    this.recordDockHand(point,now,open && !held && !blocked);
    target=this.hit(point,overTutorial ? tutorial : null);
    const wasDragging=Boolean(this.sizeDrag);
    if(blocked || (!palmMode && fist) || !held || (this.sizeDrag && (this.sizeDrag.target.disabled || !this.visible(this.sizeDrag.target)))) this.sizeDrag=null;
    const pinchPoint=palmMode ? point : this.mapPoint({x:(measured[4].x+measured[8].x)/2,y:(measured[4].y+measured[8].y)/2,z:(measured[4].z+measured[8].z)/2});
    if(!this.sizeDrag && !wasDragging && (target?.id==='tool-size' || target?.hasAttribute?.('data-hand-range')) && held && (palmMode || !fist) && !blocked) {
      target.onHandAdjustStart?.();
      this.sizeDrag={target,startX:pinchPoint.x,startValue:Number(target.value)};
    }
    if(this.sizeDrag) target=this.sizeDrag.target;
    const key = target && (target.id || target.dataset.maskBase || target.dataset.eyeBase || (target.classList.contains('mask-picker-start') ? 'picker-next' : target.classList.contains('mask-picker-back') ? 'picker-back' : `${this.page}:${target.dataset.handAction ?? target.dataset.adjust ?? target.dataset.paintColor}:${target.dataset.value ?? ''}`));
    const rect = target?.getBoundingClientRect();
    const bounds = rect && { left: rect.left - 12, right: rect.right + 12, top: rect.top - 12, bottom: rect.bottom + 12 };
    const isRange=target?.id==='tool-size' || target?.hasAttribute?.('data-hand-range');
    const slider=isRange || wasDragging;
    const response = slider && !blocked ? {owns:true,phase:this.sizeDrag?'selected':'point',progress:this.sizeDrag?1:0,target:this.sizeDrag?.target ?? (isRange?target:null)} : this.selection.update({ point, target, key, bounds, fist, blocked,
      modal: this.isOpen || Boolean(overTutorial && !blocked), now });
    if(slider)this.selection.reset();
    const adjustingSize=Boolean(this.sizeDrag) && !blocked;
    if(adjustingSize) {
      const {startX,startValue}=this.sizeDrag;
      const min=Number(target.min),max=Number(target.max),step=Number(target.step)||1;
      const value=Math.max(min,Math.min(max,min+Math.round((startValue-min+(pinchPoint.x-startX)*(max-min)/Math.max(1,rect.width-24))/step)*step));
      if(Number(target.value)!==value) {
        if(target.id==='tool-size')this.onAction('size',value);
        else {target.value=String(value);target.dispatchEvent(new Event('input',{bubbles:true}));}
      }
    }
    this.lastAt = now; this.gapAt = null;
    this.highlight?.classList.remove('hand-hover', 'hand-selected');
    this.highlight = response.target ?? null;
    this.highlight?.classList.add('hand-hover');
    if (response.phase === 'selected') this.highlight?.classList.add('hand-selected');
    this.drawCursor(now);
    this.cursor.dataset.phase = response.phase;
    this.cursor.style.setProperty('--dwell-progress', `${response.progress * 360}deg`);
    // The fingertip stays visible while an edit owns input. Blocking menu
    // selection must not hide the pointer used to trace a cut or pull.
    this.cursor.hidden = false;
    const rangeName = target?.getAttribute('aria-label') || 'Tool size';
    const grip = palmMode ? 'Close your hand' : 'Pinch';
    if (adjustingSize) this.announce(`${rangeName} ${target.getAttribute('aria-valuetext') || target.value + '%'} · slide, then ${palmMode ? 'open your hand' : 'release'} to finish`);
    else if(slider && !blocked) this.announce(wasDragging ? `Value kept · ${grip.toLowerCase()} to adjust again` : `${grip} and slide to adjust ${rangeName.toLowerCase()}`);
    else if (response.phase === 'selected') this.announce('Selected · move away to choose again');
    else if (response.target && !blocked) {
      const label = response.target.getAttribute('aria-label') || response.target.textContent.trim();
      this.announce(response.phase === 'point' ? 'Point with your index to choose' : `Hold until the ring fills to select ${label}`);
    } else if (this.isOpen) this.announce((palmMode ? 'Hold your open palm on an option until the ring fills' : 'Hold your index on an option until the ring fills'));
    else this.feedback.hidden = true;
    if (response.activated?.id !== 'tool-size' && !response.activated?.hasAttribute?.('data-hand-range') && response.activated?.isConnected && !response.activated.disabled && this.visible(response.activated)) {
      response.activated.click();
      this.announce('Selected · move away to choose again');
    }
    if(palmMode && !slider && response.phase !== 'selected' && response.target)this.announce('Hold your open palm here to choose');
    return { owns: response.owns, index: hand.index, needsOpen: !open, changed: hand.changed };
  }
}

export function rangeValueAt(x,rect,min=0,max=90,step=1) {
  // Reserve the thumb's half-width so both extremes remain reachable.
  const inset=Math.min(12,rect.width/4),width=Math.max(1,rect.width-inset*2);
  const ratio=Math.max(0,Math.min(1,(x-rect.left-inset)/width));
  return Math.max(min,Math.min(max,min+Math.round((max-min)*ratio/step)*step));
}
