import {MASK_SHAPES} from './clayShapes.js';

const actionIcons={close:'m6 6 12 12M18 6 6 18',refresh:'M4 10a8 8 0 1 1 2 8M4 4v6h6',signout:'M10 4H4v16h6M10 12h11m-5-5 5 5-5 5',edit:'m15 3 6 6-11 11-6 1 1-6zM13 5l6 6',delete:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',share:'M8 12l9-6M8 12l9 6M7 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM21 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM21 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'};
function iconAction(button,label){
  button.title=label;button.setAttribute('aria-label',label);button.classList.add('collection-icon-action');
  button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${actionIcons[button.dataset.collection]}"/></svg>`;
}

export class MaskCollectionUI {
  constructor({stage,model,onOpen,onClose,onLoad,onSaveCurrent}){
    Object.assign(this,{stage,model,onOpen,onClose,onLoad,onSaveCurrent});
    const root=this.element=document.createElement('section');root.id='mask-collection';root.hidden=true;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','mask-collection-title');
    root.innerHTML=`<div class="mask-collection-card"><header><div><p class="collection-eyebrow">MADE BY YOU</p><h2 id="mask-collection-title">Save your mask</h2></div><button type="button" data-collection="close" aria-label="Close collection">Close</button></header>
      <p class="collection-status" role="status" aria-live="polite"></p>
      <form class="collection-share collection-auth" hidden><label for="friend-mask-email" class="visually-hidden">Friend’s email</label><div class="collection-share-email"><input id="friend-mask-email" type="email" required maxlength="254" autocomplete="email" placeholder="friend@example.com" aria-describedby="collection-share-help"><button type="submit" class="collection-icon-action" data-collection="send-share" aria-label="Share mask with friend" title="Share mask with friend"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/></svg></button></div><p id="collection-share-help" hidden>Added to their collection after sign-in. No email is sent.</p><div class="collection-share-or">OR</div><button type="button" data-collection="copy-link" aria-live="polite">Copy link</button><p hidden>Anyone with the link can view and try your mask.</p></form>
      <div class="collection-delete-confirm" hidden><p></p><button type="button" data-collection="delete-confirm">Delete mask permanently</button><button type="button" data-collection="delete-cancel">Cancel</button></div>
      <form class="collection-auth"><label for="collection-email">Email</label><input id="collection-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com">
      <label for="collection-password">Password</label><input id="collection-password" name="password" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters">
      <button type="submit" data-collection="submit" class="collection-primary">Create account & save</button></form>
      <div class="collection-auth-actions"><button type="button" data-collection="login">Already registered? Sign in</button><button type="button" data-collection="register">Create an account</button></div>
      <div class="collection-confirm" hidden><p>You can close this window while you check your email. Your waiting mask is kept on this device.</p><button type="button" data-collection="login">I’ve confirmed — sign in</button></div>
      <form class="collection-name collection-auth" hidden><label for="collection-mask-name">Mask name</label><input id="collection-mask-name" name="maskName" type="text" required maxlength="120" autocomplete="off">
      <button type="submit" data-collection="save-name" class="collection-primary">Save mask</button><button type="button" data-collection="keep-name">Keep current name</button></form>
      <div class="collection-account" hidden><p class="collection-email"></p><div class="collection-actions"><button type="button" data-collection="refresh">Refresh collection</button><button type="button" data-collection="signout">Sign out</button></div><div class="collection-masks"></div><div class="collection-pages"><button type="button" data-collection="previous">Previous</button><button type="button" data-collection="next">Next</button></div></div>
      <div class="collection-pending" hidden><button type="button" data-collection="retry" class="collection-primary">Save waiting mask</button><button type="button" data-collection="copy">Save as a new copy</button><button type="button" data-collection="discard">Discard waiting save</button></div>
      <p class="collection-privacy">Your masks stay private unless you share them. Saving keeps the shape and paint so you can create again later.</p></div>`;
    const headerActions=document.createElement('div');headerActions.className='collection-header-actions';
    for(const action of ['refresh','signout','close']){const control=root.querySelector(`[data-collection="${action}"]`);iconAction(control,control.textContent);headerActions.append(control);}
    root.querySelector('header').append(headerActions);root.querySelector('.collection-actions').remove();
    this.selectionActions=document.createElement('div');this.selectionActions.className='collection-selection-actions';this.selectionActions.setAttribute('role','group');this.selectionActions.setAttribute('aria-label','Selected mask actions');
    for(const [action,label]of [['edit','Edit selected mask'],['delete','Delete selected mask'],['share','Share selected mask']]){const control=document.createElement('button');control.type='button';control.dataset.collection=action;iconAction(control,label);this.selectionActions.append(control);}
    root.querySelector('.collection-masks').before(this.selectionActions);
    const tabs=document.createElement('div');tabs.className='collection-tabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Collection category');
    for(const [category,label]of [['own','My masks'],['shared','Shared with you']]){const tab=document.createElement('button');tab.type='button';tab.dataset.collection=category;tab.textContent=label;tabs.append(tab);}
    this.tabs=tabs;this.selectionActions.before(tabs);
    stage.append(root);this.form=root.querySelector('form.collection-auth:not(.collection-share):not(.collection-name)');this.email=root.querySelector('#collection-email');this.password=root.querySelector('#collection-password');
    this.nameForm=root.querySelector('.collection-name');this.maskName=root.querySelector('#collection-mask-name');
    this.shareForm=root.querySelector('.collection-share');this.friendEmail=root.querySelector('#friend-mask-email');
    this.shareForm.addEventListener('submit',async event=>{event.preventDefault();if(!this.shareForm.reportValidity()||model.busy)return;
      try{if(await model.share(this.shareTarget,this.friendEmail.value)){this.shareTarget=null;this.friendEmail.value='';this.render();}}catch(error){model.fail(error);}});
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('click',event=>{
      const action=event.target.closest('[data-collection]')?.dataset.collection;if(!action || event.target.closest('button')?.disabled)return;
      if(action==='submit'||action==='save-name'||action==='send-share')return;
      if(action==='close'){this.close();return;}
      this.act(action,event.target.closest('[data-collection]')?.dataset.maskId).catch(error=>model.fail(error));
    });
    this.form.addEventListener('submit',event=>{event.preventDefault();if(!this.form.reportValidity() || model.busy)return;
      const password=this.password.value;this.password.value='';model.authenticate(model.mode,this.email.value,password).catch(error=>model.fail(error));});
    this.nameForm.addEventListener('submit',event=>{event.preventDefault();if(!this.nameForm.reportValidity() || model.busy)return;
      model.confirmName(this.maskName.value).catch(error=>model.fail(error));});
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();this.close();return;}
      if(event.key!=='Tab')return;
      const targets=[...root.querySelectorAll('button,input')].filter(e=>!e.disabled && e.getClientRects().length);
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){last?.focus();event.preventDefault();}
      else if(!event.shiftKey&&document.activeElement===last){first?.focus();event.preventDefault();}
    });
    model.onChange=()=>this.render();this.render();
  }
  get visible(){return !this.element.hidden;}
  open(){
    if(!this.visible){this.previousFocus=document.activeElement;this.onOpen();this.element.hidden=false;}
    this.render();const focus=this.model.mode==='name'?this.maskName:this.element.querySelector('[data-collection="close"]');focus.focus({preventScroll:true});
    if(focus===this.maskName)this.maskName.select();
  }
  close(){this.element.hidden=true;this.password.value='';this.onClose();this.previousFocus?.focus?.({preventScroll:true});}
  async act(action,id){
    const m=this.model;if(m.busy || this.loading)return;
    id=id??this.selectedId;
    if(action==='edit'){if(id)return this.load(id);return;}
    if(action==='share'){if(!id||m.category==='shared')return;this.shareTarget=id;m.message='';this.render();this.friendEmail.focus();return;}
    if(action==='copy-link'){
      const url=await m.createShareLink(this.shareTarget);
      clearTimeout(this.copyMessageTimer);
      const button=this.element.querySelector('[data-collection="copy-link"]');
      try{
        await navigator.clipboard.writeText(url);m.message='';
        button.textContent='Copied link';
        this.copyMessageTimer=setTimeout(()=>{button.textContent='Copy link';},2000);
      }
      catch{m.message='Could not copy the link. Please try again.';}
      m.emit();return;
    }
    if(action==='own'||action==='shared'){m.category=action; m.page=0;this.selectedId=null;this.shareTarget=null;this.deleteTarget=null;await m.refresh();this.render();return;}
    if(action==='delete'){this.deleteTarget=m.rows.find(row=>row.id===id);this.render();return;}
    if(action==='delete-cancel'){this.deleteTarget=null;this.render();return;}
    if(action==='delete-confirm'){if(await m.remove(this.deleteTarget?.id,this.deleteTarget?.revision))this.deleteTarget=null;this.render();return;}
    if(action==='login'||action==='register'){
      m.mode=action;m.message=action==='login'?'Sign in to save your mask and open your collection.':'Create an account to keep your masks.';m.emit();this.email.focus();return;
    }
    if(action==='discard'){
      if(!this.confirmDiscard){this.confirmDiscard=true;m.message='Discard the waiting save? Press Discard again to confirm. The stage mask will remain.';m.emit();return;}
      this.confirmDiscard=false;return m.discard();
    }
    this.confirmDiscard=false;
    if(action==='retry')return m.resume();
    if(action==='keep-name')return m.confirmName(m.pending.record.label);
    if(action==='copy')return m.saveCopy();
    if(action==='signout')return m.signOut();
    if(action==='previous'||action==='next')m.page+=action==='next'?1:-1;
    if(['refresh','previous','next'].includes(action))return m.refresh();
  }
  async load(id){
    if(this.model.busy || this.loading)return;this.loading=true;this.model.message='Opening your mask…';this.render();
    try{const saved=await this.model.read(id);await this.onLoad(saved);this.model.message='Select a mask, then choose Edit, Delete or Share.';this.close();}
    catch(error){this.model.fail(error);}finally{this.loading=false;this.render();}
  }
  render(){
    const m=this.model,root=this.element,auth=!m.user&&['register','login'].includes(m.mode),busy=Boolean(m.busy||this.loading);
    const naming=Boolean(m.user&&m.pending&&m.mode==='name');
    this.tabs.hidden=!m.user||naming;
    for(const tab of this.tabs.children)tab.setAttribute('aria-pressed',String((m.category??'own')===tab.dataset.collection));
    if(this.selectionOwner!==m.user?.id)this.shareTarget=null;
    this.shareForm.hidden=!this.shareTarget||!m.user||naming;this.friendEmail.disabled=busy;
    const openControl=this.selectionActions.querySelector('[data-collection="edit"]');
    iconAction(openControl,m.category==='shared'?'Try on selected mask':'Edit selected mask');
    for(const action of ['delete','share'])this.selectionActions.querySelector(`[data-collection="${action}"]`).hidden=m.category==='shared';
    if(this.selectionOwner!==m.user?.id){this.selectedId=null;this.selectionOwner=m.user?.id;}
    if(!m.rows.some(row=>row.id===this.selectedId))this.selectedId=null;
    this.selectionActions.hidden=!this.selectedId||naming||!m.user;
    for(const action of ['refresh','signout'])root.querySelector(`[data-collection="${action}"]`).hidden=!m.user;
    if(!m.user || !m.rows.some(row=>row.id===this.deleteTarget?.id))this.deleteTarget=null;
    root.querySelector('.collection-delete-confirm').hidden=!this.deleteTarget;
    root.querySelector('.collection-delete-confirm p').textContent=this.deleteTarget?`Delete “${this.deleteTarget.name}” from your collection? This cannot be undone. Any copy open in the studio will remain.`:'';
    root.querySelector('h2').textContent=naming?'Name your mask':this.shareTarget?'Share mask':m.user?'My collection':m.mode==='confirm'?'Check your email':'Save your mask';
    root.querySelector('.collection-status').textContent=m.message;
    root.querySelector('.collection-status').hidden=!m.message;
    root.querySelector('.collection-privacy').hidden=Boolean(this.shareTarget);
    root.querySelector('.collection-eyebrow').hidden=Boolean(this.shareTarget);
    this.form.hidden=!auth;this.password.minLength=m.mode==='register'?8:1;this.password.autocomplete=m.mode==='register'?'new-password':'current-password';
    this.password.placeholder=m.mode==='register'?'At least 8 characters':'Your password';
    root.querySelector('[data-collection="submit"]').textContent=busy?'Please wait…':m.mode==='register'?'Create account & continue':m.pending?'Sign in & continue':'Sign in';
    this.nameForm.hidden=!naming;this.maskName.disabled=busy;
    if(naming&&this.namingRequestId!==m.pending.requestId){this.maskName.value=m.pending.record.label;this.namingRequestId=m.pending.requestId;}
    if(naming&&this.previousMode!=='name'&&this.visible)requestAnimationFrame(()=>{if(this.visible&&m.mode==='name'){this.maskName.focus();this.maskName.select();}});
    this.previousMode=m.mode;
    root.querySelector('.collection-auth-actions').hidden=!auth;
    root.querySelector('.collection-auth-actions [data-collection="login"]').hidden=m.mode==='login';
    root.querySelector('.collection-auth-actions [data-collection="register"]').hidden=m.mode==='register';
    root.querySelector('.collection-confirm').hidden=m.mode!=='confirm';
    root.querySelector('.collection-account').hidden=!m.user||naming;
    root.querySelector('.collection-email').textContent=m.user?.email ?? '';
    root.querySelector('.collection-pending').hidden=!m.pending||naming;
    root.querySelector('[data-collection="retry"]').hidden=!m.user;
    root.querySelector('[data-collection="copy"]').hidden=!m.conflict;
    root.querySelector('[data-collection="previous"]').hidden=m.page===0;
    root.querySelector('[data-collection="next"]').hidden=!m.hasNext;
    const signature=JSON.stringify(m.rows);
    if(this.rowSignature!==signature){this.rowSignature=signature;const grid=root.querySelector('.collection-masks');grid.replaceChildren();
      for(const row of m.rows){
        const card=document.createElement('button');card.type='button';card.className='collection-mask-card';card.dataset.savedMask=row.id;
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
        const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',MASK_SHAPES[row.shape]?.icon ?? MASK_SHAPES.full.icon);path.style.fill=/^#[\da-f]{6}$/i.test(row.color)?row.color:'#cd6e45';icon.append(path);
        const label=document.createElement('span');label.textContent=row.name;
        const date=document.createElement('small');date.textContent=`Saved ${new Date(row.updated_at).toLocaleDateString()}`;
        card.append(icon,label,date);card.addEventListener('click',()=>{if(this.model.busy||this.loading)return;this.selectedId=row.id;this.deleteTarget=null;this.model.message=`${row.name} selected. Choose Edit, Delete or Share.`;this.render();});
        const group=document.createElement('div');group.className='collection-mask-item';
        group.append(card);grid.append(group);
      }
    }
    for(const card of root.querySelectorAll('[data-saved-mask]'))card.setAttribute('aria-pressed',String(card.dataset.savedMask===this.selectedId));
    for(const button of root.querySelectorAll('button'))button.disabled=busy&&button.dataset.collection!=='close';
    this.email.disabled=this.password.disabled=busy;
  }
}
