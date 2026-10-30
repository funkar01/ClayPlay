const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/bhanu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async()=>{
  const{createServer}=await import('vite');
  const server=await createServer({cacheDir:'node_modules/.vite-mask-collection-test',server:{host:'127.0.0.1',port:5182,strictPort:true,watch:{ignored:['**/artifacts/**']}},define:{
    'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://clayplay-test.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_collection_browser_test'),
  }});
  let browser;const rows=new Map(),users=new Map(),errors=[],requests=[];let failSave=false,confirmation=true;
  const makeSession=user=>{const exp=Math.floor(Date.now()/1000)+3600;
    const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,aud:'authenticated',role:'authenticated',exp}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.test-signature';
    return {access_token:token,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user};};
  async function mock(context){
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route('https://clayplay-test.supabase.co/**',async route=>{
      const req=route.request(),url=new URL(req.url());const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(url.pathname==='/auth/v1/signup'){
        const data=req.postDataJSON();assert.ok(data.password);const user={id:crypto.randomUUID(),email:data.email,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()};
        users.set(data.email,{user,password:data.password});return reply(confirmation?{...user,identities:[]}:makeSession(user));
      }
      if(url.pathname==='/auth/v1/token'){
        const data=req.postDataJSON(),account=users.get(data.email);if(!account||account.password!==data.password)return reply({msg:'Invalid email or password',error_code:'invalid_credentials'},400);
        return reply(makeSession(account.user));
      }
      if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
      let uid;try{uid=JSON.parse(Buffer.from(req.headers().authorization.split(' ')[1].split('.')[1],'base64url').toString()).sub;}catch{}
      if(url.pathname==='/auth/v1/user'){const found=[...users.values()].find(a=>a.user.id===uid);return reply(found?.user ?? {},found?200:401);}
      if(!uid)return reply({message:'Not signed in'},401);
      if(url.pathname==='/rest/v1/rpc/save_collection_mask'){
        const body=req.postDataJSON();requests.push(body);
        if(failSave)return reply({code:'503',message:'Connection unavailable'},503);
        const old=rows.get(body.mask_id);
        if(old?.save_request===body.save_request)return reply({id:old.id,revision:old.revision});
        if(old && (old.owner_id!==uid||old.revision!==body.expected_revision))return reply({code:'40001',message:'Mask changed on another device'},409);
        const row={id:body.mask_id,owner_id:uid,revision:(old?.revision??0)+1,name:body.mask_name,shape:body.mask_shape,color:body.mask_color,payload:body.mask_payload,save_request:body.save_request,updated_at:new Date().toISOString()};rows.set(row.id,row);
        return reply({id:row.id,revision:row.revision});
      }
      if(url.pathname==='/rest/v1/saved_masks'){
        let data=[...rows.values()].filter(row=>row.owner_id===uid);
        if(url.searchParams.has('id'))data=data.filter(row=>row.id===url.searchParams.get('id').slice(3));
        if(url.searchParams.get('select')?.includes('payload'))return reply(data[0]);
        return reply(data.map(({payload,save_request,...row})=>row));
      }
      throw new Error(`Unexpected test request: ${url.pathname}`);
    });
  }
  const root='#mask-collection',action=name=>`${root} [data-collection="${name}"]`;
  const status=page=>page.locator(`${root} .collection-status`);
  const ready=page=>page.waitForFunction(()=>window.clayPlayDebug&&!window.clayPlayDebug.getState().pending,{}, {timeout:60000});
  async function enterStudio(page){
    await ready(page);await page.locator('.comfort-skip').click();await page.locator('#tutorial-skip').click();await page.locator('#mask-picker-continue').click();await ready(page);
  }
  async function saved(page){await page.waitForFunction(()=>document.querySelector('#mask-collection .collection-status')?.textContent.startsWith('Saved to your collection')&&!document.querySelector('#hand-save-mask')?.disabled,{}, {timeout:60000});}
  async function fingerSave(page){
    const box=await page.locator('#hand-save-mask').boundingBox();
    await page.evaluate(async({x,y})=>{
      const d=window.clayPlayDebug,b=document.querySelector('#stage').getBoundingClientRect();d.setControlMode('index');
      const nx=1-(x-b.x)/b.width,ny=(y-b.y)/b.height;
      const p=Array.from({length:21},()=>({x:nx,y:ny+.08,z:0}));p[0].y=ny+.2;p[5]={x:nx-.05,y:ny+.1,z:0};p[9].y=ny+.09;p[17]={x:nx+.08,y:ny+.12,z:0};
      for(const[joint,tip,dx]of[[6,8,0],[10,12,.025],[14,16,.06],[18,20,.095]]){p[joint]={x:nx+dx,y:ny+.06,z:0};p[tip]={x:nx+dx,y:ny-.015,z:0};}
      p[8]={x:nx,y:ny,z:0};p[4]={x:nx-.08,y:ny,z:0};
      for(let i=0;i<40;i++){d.feedHands([p],performance.now(),{handedness:[[{categoryName:'Left'}]]});await new Promise(resolve=>setTimeout(resolve,33));}
    },{x:box.x+box.width/2,y:box.y+box.height/2});
  }
  async function fingerprint(page){return page.evaluate(()=>{const i=window.clayPlayDebug.objects.active;const first=[...i.volume.bricks.values()][0];return{state:JSON.parse(JSON.stringify(i.volume.serialize())),color:i.material.color.getHexString(),roughness:i.material.roughness,scale:i.volume.userScale??1,offset:i.volume.userOffset??[0,0],surface:Array.from(first.mesh.geometry.attributes.position.array.slice(0,18))};});}
  try{
    await server.listen();browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});await mock(context);const page=await context.newPage();await page.goto('http://127.0.0.1:5182/?diagnostics');await enterStudio(page);
    const selfie=await page.locator('#hand-selfie').boundingBox(),save=await page.locator('#hand-save-mask').boundingBox();assert.ok(save.y>=selfie.y+selfie.height+8);assert.ok(Math.abs(save.x-selfie.x)<1);
    const protectedPending=await page.evaluate(async()=>{
      const{PendingMask}=await import('/src/pendingMask.js'),first=new PendingMask(),second=new PendingMask();
      await first.set({requestId:'first-test-save'},{create:true});let blocked=false;
      try{await second.set({requestId:'other-test-save'},{create:true});}catch{blocked=true;}
      const retained=(await first.get()).requestId;await first.clear('first-test-save');return{blocked,retained};
    });assert.deepEqual(protectedPending,{blocked:true,retained:'first-test-save'});
    // Sculpt through the real pointer path, using real geometry workers.
    await page.locator('#tool-pinch').click();
    const project=point=>page.evaluate(point=>{const d=window.clayPlayDebug,p=new d.camera.position.constructor(...point);d.objects.active.group.localToWorld(p);p.project(d.camera);const b=document.querySelector('#three-scene').getBoundingClientRect();return{x:b.x+(p.x+1)*b.width/2,y:b.y+(1-p.y)*b.height/2};},point);
    const a=await project([.65,-.4,.5]),b=await project([.86,-.3,.5]);await page.mouse.move(a.x,a.y);await page.waitForTimeout(200);await page.mouse.down();await page.waitForTimeout(100);await page.mouse.move(b.x,b.y,{steps:12});await page.waitForTimeout(100);await page.mouse.up();await ready(page);
    try{await page.waitForFunction(()=>Boolean(window.clayPlayDebug.objects.active.volume.pullSource),{}, {timeout:15000});}
    catch(error){console.log('Sculpt setup',await page.evaluate(()=>({debug:window.clayPlayDebug.getState(),dialogs:[...document.querySelectorAll('[role="dialog"]')].map(e=>({id:e.id,hidden:e.hidden})),contact:document.querySelector('#contact-label')?.textContent})));await page.screenshot({path:'artifacts/mask-save-sculpt-debug.png'});throw error;}
    await page.evaluate(()=>{const i=window.clayPlayDebug.objects.active;i.material.color.set('#bb3377');i.material.roughness=.35;i.volume.userScale=1.2;i.volume.userOffset=[.15,-.12];i.volume.paint.set('0,0,0',[.3,.2,.1,1]);});
    const before=await fingerprint(page);await fingerSave(page);await page.locator('#collection-email').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#mask-collection .collection-status').textContent.includes('Create an account'));
    await page.locator('#collection-email').fill('mask@example.test');await page.locator('#collection-password').fill('test-password-123');await page.locator(action('submit')).click();
    await status(page).filter({hasText:'Check your email'}).waitFor();assert.equal(rows.size,0);
    await page.reload();await ready(page);await enterStudio(page);await page.locator('#hand-save-mask').click();await page.locator(action('login')+':visible').first().click();
    await page.locator('#collection-email').fill('mask@example.test');await page.locator('#collection-password').fill('wrong-password');await page.locator(action('submit')).click();await status(page).filter({hasText:'Invalid email or password'}).waitFor();assert.equal(rows.size,0);
    await page.locator('#collection-password').fill('test-password-123');await page.locator(action('submit')).click();await saved(page);assert.equal(rows.size,1);
    const id=[...rows.keys()][0];await page.locator(`[data-saved-mask="${id}"]`).click();await page.locator(root).waitFor({state:'hidden'});assert.deepEqual(await fingerprint(page),before,'Login saves the original pre-registration editable mask');
    await page.locator('#hand-save-mask').click();await saved(page);assert.equal(rows.size,1);assert.equal(rows.get(id).revision,2);
    await page.locator(action('close')).click();failSave=true;await page.locator('#hand-save-mask').click();await status(page).filter({hasText:'Connection unavailable'}).waitFor();assert.equal(rows.get(id).revision,2);
    await page.reload();await ready(page);
    await enterStudio(page);await page.locator('#hand-save-mask').click();await status(page).filter({hasText:'Connection unavailable'}).waitFor();
    failSave=false;await page.locator(action('retry')).click();await saved(page);assert.equal(rows.size,1);assert.equal(rows.get(id).revision,3);
    const secondContext=await browser.newContext();await mock(secondContext);const second=await secondContext.newPage();await second.goto('http://127.0.0.1:5182/?diagnostics');await enterStudio(second);
    await second.locator('#hand-more').click();await second.locator('[data-hand-action="collection"]').click();await second.locator('#collection-email').fill('mask@example.test');await second.locator('#collection-password').fill('test-password-123');await second.locator(action('submit')).click();
    await second.locator(`[data-saved-mask="${id}"]`).click();await second.locator(root).waitFor({state:'hidden'});assert.deepEqual(await fingerprint(second),before,'Another device restores the exact editable mask');
    // Both devices now edit revision 3. Saving from one makes the other stale.
    await page.locator(`[data-saved-mask="${id}"]`).click();await page.locator(root).waitFor({state:'hidden'});await page.locator('#hand-save-mask').click();await saved(page);
    await second.locator('#hand-save-mask').click();await status(second).filter({hasText:'another device'}).waitFor();await second.locator(action('copy')).click();await saved(second);assert.equal(rows.size,2);
    await second.locator(action('signout')).click();await second.locator('#collection-email').waitFor({state:'visible'});assert.equal(await second.locator('[data-saved-mask]').count(),0);
    confirmation=false;await second.locator(action('close')).click();await second.locator('#hand-save-mask').click();
    await second.waitForFunction(()=>document.querySelector('#mask-collection .collection-status')?.textContent.includes('Create an account'));
    await second.locator('#collection-email').fill('another@example.test');await second.locator('#collection-password').fill('another-password-123');await second.locator(action('submit')).click();await saved(second);
    assert.equal(rows.size,3);assert.equal(await second.locator('[data-saved-mask]').count(),1,'New accounts see only their own saved mask');
    await page.setViewportSize({width:390,height:844});const modal=await page.locator('.mask-collection-card').boundingBox();assert.ok(modal.x>=0&&modal.x+modal.width<=390);await page.screenshot({path:'artifacts/mask-collection-mobile.png'});
    await page.locator(action('close')).click();const mobileSelfie=await page.locator('#hand-selfie').boundingBox(),mobileSave=await page.locator('#hand-save-mask').boundingBox();assert.ok(mobileSave.y>=mobileSelfie.y+mobileSelfie.height+8);
    await secondContext.close();assert.deepEqual(errors,[]);console.log('Mask collections passed: Save placement and finger selection, real sculpt snapshot, confirmation/reload, invalid/correct password, automatic save after login, direct update, offline retry, second device, conflict copy, sign-out, and mobile layout. Supabase was simulated.');
  }finally{await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
