const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/bhanu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const {createServer}=await import('vite');const {packMask}=await import('../src/maskCodec.js');
 const record={version:1,label:'Friend mask',shape:'full',color:'#cd6e45',roughness:.4,scale:1,offset:[0,0],state:{shape:'full',eyeShape:'oval',field:[],paint:[],paintCell:.04},bricks:[]};
 const payload=await packMask(record);const token='3eb9c436-d830-4184-87de-eae691f80861';
 const server=await createServer({server:{host:'127.0.0.1',port:5183,strictPort:true},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://clayplay-test.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_test')}});
 let browser;const errors=[];
 try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://clayplay-test.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().includes('open_mask_share_link')?payload:[])}));
  await page.goto(`http://127.0.0.1:5183/#mask=${token}`);
  await page.locator('.shared-mask-view p').filter({hasText:'Friend mask'}).waitFor({timeout:60000});
  await assert.equal(await page.locator('#hand-save-mask').isDisabled(),true);
  await assert.equal(await page.locator('.comfort-skip').isVisible(),false);
  await page.locator('.shared-mask-view button').filter({hasText:'Back to my masks'}).click();
  await assert.equal(await page.locator('.shared-mask-view').isVisible(),false);
  assert.equal(await page.evaluate(()=>location.hash),'');
  assert.deepEqual(errors,[]);console.log('Public link preview, save restriction and restoration passed.');
 }finally{await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
