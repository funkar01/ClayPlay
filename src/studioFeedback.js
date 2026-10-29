export function trackingPresentation({cameraOn=false,tracked=false,held=false,paused=false,trying=false,palm=true}={}) {
  if(trying)return {state:'neutral',label:'Try-on mode',symbol:'◉'};
  if(paused)return {state:'paused',label:'Editing paused',symbol:'Ⅱ'};
  if(!cameraOn)return {state:held?'held':'ready',label:held?'Creating · release to keep':'Cursor mode · ready',symbol:'↗'};
  if(!tracked)return {state:'searching',label:'Show an open hand to continue',symbol:'!'};
  if(held)return {state:'held',label:palm?'Shaping · open your hand to release':'Shaping · release your pinch',symbol:'●'};
  return {state:'ready',label:palm?'Hand ready · close gently to shape':'Hand ready · pinch to shape',symbol:'✓'};
}
export function studioMessagePresentation(state) {
  const tracking=trackingPresentation(state);
  if(state.applying && !state.trying && !/could not|failed|timed out|unavailable/i.test(state.hint ?? ''))
    return {state:'applying',label:state.waiting?'Applying… · please wait before shaping again':'Applying your changes…',symbol:'Ⅱ'};
  if(tracking.state==='searching' || tracking.state==='paused')return tracking;
  if(state.menuHint)return {state:'neutral',label:state.menuHint,symbol:'↗'};
  if(state.hint && /could not|failed|timed out|unavailable|size is 0/i.test(state.hint))return {state:'paused',label:state.hint,symbol:'!'};
  if(state.processing)return {state:'neutral',label:state.processing,symbol:'◷'};
  if(state.commit)return {state:'ready',label:state.commit,symbol:'✓'};
  if(state.hint && !state.trying)return {...tracking,label:state.hint};
  return tracking;
}
export function emitStudioCommit(tool, { intensity = .35 } = {}) {
  if(typeof document==='undefined')return;
  const event=new Event('studio-edit-committed');event.tool=tool;event.intensity=intensity;document.dispatchEvent(event);
}
export class StudioFeedback {
  constructor(stage) {
    this.stage=stage;
    this.status=document.createElement('div');this.status.className='studio-tracking-status';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    this.icon=document.createElement('span');this.icon.className='studio-status-icon';this.icon.setAttribute('aria-hidden','true');
    this.label=document.createElement('span');this.status.append(this.icon,this.label);
    stage.append(this.status);
    document.addEventListener('studio-edit-committed',event=>this.commit(event.tool));
  }
  update(state) {
    const text=element=>element && !element.hidden ? element.textContent.trim().replace(/^[✦↗✳]\s*/,'') : '';
    const hint=this.stage.querySelector('#scene-hint'),menu=this.stage.querySelector('#hand-feedback'),surface=this.stage.querySelector('.surface-status');
    const next=studioMessagePresentation({...state,hint:text(hint),menuHint:(!this.stage.querySelector('#hand-panel')?.hidden || this.stage.querySelector('.hand-ui-cursor:not([hidden])'))?text(menu):'',processing:surface?.dataset.phase==='building'?text(surface):'',commit:performance.now()<(this.commitUntil ?? 0)?this.commitMessage:''});
    if(this.status.dataset.state!==next.state)this.status.dataset.state=next.state;
    this.icon.classList.toggle('studio-loading-icon',next.state==='applying');
    if(this.label.textContent!==next.label){this.label.textContent=next.label;this.icon.textContent=next.symbol;}
    const gesture=state.held && (!state.cameraOn || state.tracked)?'held':'open';
    if(this.stage.dataset.gesture!==gesture)this.stage.dataset.gesture=gesture;
    if(this.stage.dataset.studioTool!==state.tool)this.stage.dataset.studioTool=state.tool;
  }
  commit(tool) {
    const now=performance.now();if(this.lastCommit && now-this.lastCommit<800)return;this.lastCommit=now;
    this.commitMessage=tool==='paint'?'Paint applied':tool==='erase'?'Erasure kept':'Shape kept';
    this.commitUntil=now+1400;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)this.status.animate([{opacity:.75},{opacity:1}],{duration:180});
  }
}
