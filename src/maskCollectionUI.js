import {MASK_SHAPES} from './clayShapes.js';

export class MaskCollectionUI {
  constructor({stage,model,onOpen,onClose,onLoad,onSaveCurrent}){
    Object.assign(this,{stage,model,onOpen,onClose,onLoad,onSaveCurrent});
    const root=this.element=document.createElement('section');root.id='mask-collection';root.hidden=true;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','mask-collection-title');
    root.innerHTML=`<div class="mask-collection-card"><header><div><p class="collection-eyebrow">MADE BY YOU</p><h2 id="mask-collection-title">Save your mask</h2></div><button type="button" data-collection="close" aria-label="Close collection">Close</button></header>
      <p class="collection-status" role="status" aria-live="polite"></p>
      <form class="collection-auth"><label for="collection-email">Email</label><input id="collection-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com">
      <label for="collection-password">Password</label><input id="collection-password" name="password" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters">
      <button type="submit" data-collection="submit" class="collection-primary">Create account & save</button></form>
      <div class="collection-auth-actions"><button type="button" data-collection="login">Already registered? Sign in</button><button type="button" data-collection="register">Create an account</button></div>
      <div class="collection-confirm" hidden><p>You can close this window while you check your email. Your waiting mask is kept on this device.</p><button type="button" data-collection="login">I’ve confirmed — sign in</button></div>
      <div class="collection-account" hidden><p class="collection-email"></p><div class="collection-actions"><button type="button" data-collection="refresh">Refresh collection</button><button type="button" data-collection="signout">Sign out</button></div><div class="collection-masks"></div><div class="collection-pages"><button type="button" data-collection="previous">Previous</button><button type="button" data-collection="next">Next</button></div></div>
      <div class="collection-pending" hidden><button type="button" data-collection="retry" class="collection-primary">Save waiting mask</button><button type="button" data-collection="copy">Save as a new copy</button><button type="button" data-collection="discard">Discard waiting save</button></div>
      <p class="collection-privacy">Your masks are private to your account. Saving keeps the shape and paint so you can create again later.</p></div>`;
    stage.append(root);this.form=root.querySelector('form');this.email=root.querySelector('#collection-email');this.password=root.querySelector('#collection-password');
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('click',event=>{
      const action=event.target.closest('[data-collection]')?.dataset.collection;if(!action || event.target.closest('button')?.disabled)return;
      if(action==='submit')return;
      if(action==='close'){this.close();return;}
      this.act(action).catch(error=>model.fail(error));
    });
    this.form.addEventListener('submit',event=>{event.preventDefault();if(!this.form.reportValidity() || model.busy)return;
      const password=this.password.value;this.password.value='';model.authenticate(model.mode,this.email.value,password).catch(error=>model.fail(error));});
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
    this.render();this.element.querySelector('[data-collection="close"]').focus({preventScroll:true});
  }
  close(){this.element.hidden=true;this.password.value='';this.onClose();this.previousFocus?.focus?.({preventScroll:true});}
  async act(action){
    const m=this.model;if(m.busy || this.loading)return;
    if(action==='login'||action==='register'){
      m.mode=action;m.message=action==='login'?'Sign in to save your mask and open your collection.':'Create an account to keep your masks.';m.emit();this.email.focus();return;
    }
    if(action==='discard'){
      if(!this.confirmDiscard){this.confirmDiscard=true;m.message='Discard the waiting save? Press Discard again to confirm. The stage mask will remain.';m.emit();return;}
      this.confirmDiscard=false;return m.discard();
    }
    this.confirmDiscard=false;
    if(action==='retry')return m.resume();
    if(action==='copy')return m.saveCopy();
    if(action==='signout')return m.signOut();
    if(action==='previous'||action==='next')m.page+=action==='next'?1:-1;
    if(['refresh','previous','next'].includes(action))return m.refresh();
  }
  async load(id){
    if(this.model.busy || this.loading)return;this.loading=true;this.model.message='Opening your mask…';this.render();
    try{const saved=await this.model.read(id);await this.onLoad(saved);this.close();}
    catch(error){this.model.fail(error);}finally{this.loading=false;this.render();}
  }
  render(){
    const m=this.model,root=this.element,auth=!m.user&&['register','login'].includes(m.mode),busy=Boolean(m.busy||this.loading);
    root.querySelector('h2').textContent=m.user?'My collection':m.mode==='confirm'?'Check your email':'Save your mask';
    root.querySelector('.collection-status').textContent=m.message;
    this.form.hidden=!auth;this.password.minLength=m.mode==='register'?8:1;this.password.autocomplete=m.mode==='register'?'new-password':'current-password';
    this.password.placeholder=m.mode==='register'?'At least 8 characters':'Your password';
    root.querySelector('[data-collection="submit"]').textContent=busy?'Please wait…':m.mode==='register'?'Create account & save':m.pending?'Sign in & save':'Sign in';
    root.querySelector('.collection-auth-actions').hidden=!auth;
    root.querySelector('.collection-auth-actions [data-collection="login"]').hidden=m.mode==='login';
    root.querySelector('.collection-auth-actions [data-collection="register"]').hidden=m.mode==='register';
    root.querySelector('.collection-confirm').hidden=m.mode!=='confirm';
    root.querySelector('.collection-account').hidden=!m.user;
    root.querySelector('.collection-email').textContent=m.user?.email ?? '';
    root.querySelector('.collection-pending').hidden=!m.pending;
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
        card.append(icon,label,date);card.addEventListener('click',()=>this.load(row.id));grid.append(card);
      }
    }
    for(const button of root.querySelectorAll('button'))button.disabled=busy&&button.dataset.collection!=='close';
    this.email.disabled=this.password.disabled=busy;
  }
}
