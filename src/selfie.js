export const CLAYPLAY_URL='https://creativecraft-maskstudio.vercel.app/';

export function cameraCoverRect(sourceWidth,sourceHeight,width,height) {
  const scale=Math.max(width/sourceWidth,height/sourceHeight);
  return {x:(width-sourceWidth*scale)/2,y:(height-sourceHeight*scale)/2,width:sourceWidth*scale,height:sourceHeight*scale};
}

// Capture inside the render turn: WebGL's drawing buffer may be cleared later.
export async function composeSelfie(video,maskCanvas,createCanvas=()=>document.createElement('canvas')) {
  if(!video.videoWidth || !video.videoHeight || video.readyState<2)throw new Error('Camera is not ready. Try again.');
  const canvas=createCanvas(),width=Math.min(1600,maskCanvas.width);
  canvas.width=width;canvas.height=Math.round(maskCanvas.height*width/maskCanvas.width);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Photo capture is unavailable in this browser.');
  const rect=cameraCoverRect(video.videoWidth,video.videoHeight,canvas.width,canvas.height);
  ctx.save();ctx.translate(canvas.width,0);ctx.scale(-1,1);
  ctx.drawImage(video,rect.x,rect.y,rect.width,rect.height);ctx.restore();
  ctx.drawImage(maskCanvas,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create the selfie. Please try again.')),'image/jpeg',.93));
}

export function selfieShareData(file) {
  return {title:'My ClayPlay mask',text:`Creating the masks is fun, want to try it out? ${CLAYPLAY_URL}`,files:[file]};
}

// Pure timing controller; a missing face restarts the full two-second countdown.
export class SelfieCountdown {
  start(now){this.deadline=now+25000;this.started=null;this.active=true;}
  cancel(){this.active=false;this.started=null;}
  tick(now,ready) {
    if(!this.active)return 'idle';
    if(now>=this.deadline){this.cancel();return 'timeout';}
    if(!ready){this.started=null;return 'waiting';}
    this.started??=now;
    if(now-this.started>=2000){this.cancel();return 'capture';}
    return Math.ceil((2000-(now-this.started))/1000);
  }
}

export class SelfieStudio {
  constructor({stage,prepare,onExit,onChange=()=>{}}) {
    Object.assign(this,{prepare,onExit,onChange});this.countdown=new SelfieCountdown();this.epoch=0;this.phase='idle';
    const root=this.element=document.createElement('section');root.id='selfie-preview';root.hidden=true;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Mask selfie');
    root.innerHTML=`<div class="selfie-card"><header><h2>Your mask. Your moment.</h2><button type="button" data-selfie="close" aria-label="Close selfie and return to creating">Close</button></header><p class="selfie-status" role="status" aria-live="polite"></p><div class="selfie-count" aria-hidden="true"></div><img class="selfie-image" alt="Your selfie wearing your ClayPlay mask" hidden><div class="selfie-actions" hidden><button type="button" data-selfie="share">Share selfie</button><button type="button" data-selfie="download">Save photo</button><button type="button" data-selfie="copy">Copy app link</button><button type="button" data-selfie="retake">Retake</button></div><p class="selfie-link" hidden>Invite a friend: <a href="${CLAYPLAY_URL}" target="_blank" rel="noopener noreferrer">creativecraft-maskstudio.vercel.app</a></p></div>`;
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('click',event=>{
      const action=event.target.closest('[data-selfie]')?.dataset.selfie;
      if(action==='close')this.close();
      if(action==='retake')this.start();
      if(action==='download')this.download();
      if(action==='copy')this.copyLink();
      if(action==='share')this.share();
    });
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}
      if(event.key==='Tab') {
        const targets=[...root.querySelectorAll('button,a')].filter(el=>!el.disabled && !el.closest('[hidden]'));
        const index=targets.indexOf(document.activeElement),next=event.shiftKey ? (index-1+targets.length)%targets.length : (index+1)%targets.length;
        event.preventDefault();targets[next]?.focus();
      }
    });
    stage.append(root);
  }
  get busy(){return ['preparing','waiting','countdown','encoding'].includes(this.phase);}
  message(text){this.element.querySelector('.selfie-status').textContent=text;}
  async start() {
    if(this.busy)return;
    if(this.phase==='idle')this.returnFocus=document.activeElement;
    this.clearPhoto();this.phase='preparing';const epoch=++this.epoch;
    this.element.hidden=false;this.element.classList.add('is-counting');this.message('Putting your mask on…');
    this.element.querySelector('[data-selfie="close"]').focus();this.onChange();
    try {
      const ready=await this.prepare();
      if(epoch!==this.epoch)return;
      if(!ready)throw new Error('Camera or face tracking could not start. Close and try again.');
      this.countdown.start(performance.now());this.phase='waiting';this.message('Face the camera. Your selfie starts when the mask is on.');
    } catch(error){if(epoch===this.epoch)this.fail(error.message);}
  }
  tick(now,{ready,video,canvas}) {
    if(!['waiting','countdown'].includes(this.phase))return;
    const step=this.countdown.tick(now,ready);
    const number=this.element.querySelector('.selfie-count');
    if(step==='timeout'){this.fail('We could not get a clear view of your face. Close, then try again in better light.');return;}
    if(step==='waiting'){number.textContent='';this.phase='waiting';this.message('Keep your face in view. We will count down when your mask is on.');return;}
    if(step==='capture') {
      this.phase='encoding';number.textContent='';this.message('Saving your moment…');
      const epoch=this.epoch;
      composeSelfie(video,canvas).then(blob=>{
        if(epoch!==this.epoch)return;
        this.blob=blob;this.url=URL.createObjectURL(blob);this.phase='preview';
        const image=this.element.querySelector('img');image.src=this.url;image.hidden=false;
        this.element.classList.remove('is-counting');
        this.element.querySelector('.selfie-actions').hidden=false;this.element.querySelector('.selfie-link').hidden=false;
        this.message('Made by you. Ready to share with the ClayPlay link.');this.element.querySelector('[data-selfie="share"]').focus();this.onChange();
      }).catch(error=>{if(epoch===this.epoch)this.fail(error.message);});return;
    }
    this.phase='countdown';number.textContent=String(step);this.message(`Smile! Capturing in ${step}…`);
  }
  fail(message){this.phase='error';this.countdown.cancel();this.element.querySelector('.selfie-count').textContent='';this.message(message);this.onChange();}
  file(){return new File([this.blob],`clayplay-selfie-${Date.now()}.jpg`,{type:'image/jpeg'});}
  async share() {
    if(!this.blob || this.sharing)return;
    const data=selfieShareData(this.file());
    if(!navigator.share || !navigator.canShare?.(data)){this.download();this.message('Photo downloaded. Copy the app link below and attach both in your favorite app.');return;}
    this.sharing=true;
    try {await navigator.share(data);this.message('Selfie shared!');}
    catch(error){if(error.name!=='AbortError')this.message('Sharing could not open. Use Save photo and Copy app link.');}
    finally{this.sharing=false;}
  }
  download() {
    if(!this.url)return;
    const a=document.createElement('a');a.href=this.url;a.download=`clayplay-selfie-${Date.now()}.jpg`;a.click();
  }
  async copyLink() {
    try {await navigator.clipboard.writeText(CLAYPLAY_URL);this.message('App link copied. Send it along with your selfie.');}
    catch {this.message(`Copy this link: ${CLAYPLAY_URL}`);}
  }
  clearPhoto() {
    if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.blob=null;
    this.element.querySelector('img').hidden=true;this.element.querySelector('img').removeAttribute('src');
    this.element.querySelector('.selfie-actions').hidden=true;this.element.querySelector('.selfie-link').hidden=true;
    this.element.querySelector('.selfie-count').textContent='';
  }
  close() {
    this.epoch++;this.countdown.cancel();this.phase='idle';this.element.hidden=true;this.clearPhoto();this.onChange();this.onExit();
    if(this.returnFocus?.isConnected)this.returnFocus.focus();
  }
  dispose(){this.epoch++;this.phase='idle';this.countdown.cancel();this.clearPhoto();this.element.remove();}
}
