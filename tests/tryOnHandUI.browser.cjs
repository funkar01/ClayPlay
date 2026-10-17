const assert = require('node:assert/strict');

module.exports = async function(page) {
  await page.addInitScript(() => {
    window.testHands = []; window.testFaceVisible = true;
    window.testDelays = {hand:70, face:320};
    window.inferences = []; window.handClicks = [];
    const RealWorker = window.Worker;
    window.Worker = function(url, options) {
      if (!String(url).includes('trackingWorker')) return new RealWorker(url, options);
      const stats = {task:'hand', active:0, peak:0, frames:0, times:[]};
      window.inferences.push(stats);
      return {closed:false, postMessage(data) {
        data.bitmap?.close();
        if (data.type === 'init') stats.task = data.task;
        const frame = data.type === 'frame';
        const duration = frame ? window.testDelays[stats.task] : 2;
        let result = true;
        if (frame) {
          stats.frames++; stats.active++; stats.peak = Math.max(stats.peak, stats.active);
          stats.times.push(performance.now());
          if (stats.task === 'hand') result = {landmarks:structuredClone(window.testHands),
            handedness:window.testHands.map(() => [{categoryName:'Left'}])};
          else {
            const points = Array.from({length:478}, () => ({x:.5,y:.45,z:0}));
            for (const index of [33,133]) points[index].x = .41;
            for (const index of [263,362]) points[index].x = .59;
            result = {faceLandmarks:window.testFaceVisible ? [points] : []};
          }
        }
        setTimeout(() => {
          if (frame) stats.active--;
          if (!this.closed) this.onmessage?.({data:{id:data.id,result,duration:frame?duration:undefined}});
        }, duration);
      }, terminate() { this.closed = true; }};
    };
    window.Worker.prototype = RealWorker.prototype;
    const bitmap = window.createImageBitmap;
    window.createImageBitmap = (source,...args) => source instanceof HTMLVideoElement ? Promise.resolve({close(){}}) : bitmap(source,...args);
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d'); let n = 0;
      const draw = () => {ctx.fillStyle = ++n%2?'#bcc4ce':'#bdc5cf';ctx.fillRect(0,0,1280,720);};
      draw(); setInterval(draw,33); return canvas.captureStream(30);
    };
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-test-hand-click]');
      if (target) window.handClicks.push(target.dataset.testHandClick);
    },true);
  });
  await page.goto(process.env.CLAYPLAY_TEST_URL || 'http://127.0.0.1:5174/?diagnostics');
  const state = () => page.evaluate(() => window.clayPlayDebug.getState());
  const idle = () => page.waitForFunction(() => window.clayPlayDebug && !window.clayPlayDebug.getState().pending);
  await idle();
  const geometry = () => page.evaluate(() => {
    const values = [];
    for (const {mesh} of window.clayPlayDebug.objects.active.volume.bricks.values()) values.push(...mesh.geometry.attributes.position.array);
    return values;
  });
  const original = await geometry();
  await page.locator('#studio-message-ok').click();
  await page.waitForFunction(() => window.clayPlayDebug.getState().cameraOn && !document.querySelector('#camera-button').disabled);
  if (await page.locator('#studio-tutorial').isVisible()) await page.locator('#tutorial-skip').click();
  async function aim(x,y) {
    await page.evaluate(({x,y}) => {
      const b = document.querySelector('#stage').getBoundingClientRect(), v = document.querySelector('#camera-video');
      let nx = (x-b.x)/b.width, ny = (y-b.y)/b.height;
      if (window.clayPlayDebug.getState().arLive) {
        const a = v.videoWidth/v.videoHeight, view = b.width/b.height, sx = Math.max(1,a/view), sy = Math.max(1,view/a);
        nx = (nx+(sx-1)/2)/sx; ny = (ny+(sy-1)/2)/sy;
      }
      nx = 1-nx;
      const p = Array.from({length:21}, () => ({x:nx,y:ny+.08,z:0}));
      p[0].y = ny+.2; p[5] = {x:nx-.05,y:ny+.1,z:0}; p[9].y = ny+.09;
      p[13] = {x:nx+.04,y:ny+.1,z:0}; p[17] = {x:nx+.08,y:ny+.12,z:0};
      for (const [joint,tip,dx] of [[6,8,0],[10,12,.025],[14,16,.06],[18,20,.095]]) {
        p[joint] = {x:nx+dx,y:ny+.06,z:0}; p[tip] = {x:nx+dx,y:ny-.015,z:0};
      }
      p[8] = {x:nx,y:ny,z:0}; p[4] = {x:nx-.08,y:ny,z:0}; window.testHands = [p];
    },{x,y});
  }
  let sequence = 0;
  async function select(selector) {
    const target = page.locator(selector); await target.waitFor({state:'visible'});
    const stage = await page.locator('#stage').boundingBox();
    await aim(stage.x+stage.width-25, stage.y+25); await page.waitForTimeout(350);
    const box = await target.boundingBox(), tag = String(++sequence);
    await target.evaluate((element,tag) => element.dataset.testHandClick = tag,tag);
    await aim(box.x+box.width/2,box.y+box.height/2);
    await page.waitForFunction(tag => window.handClicks.includes(tag),tag,{timeout:6000});
    await page.waitForTimeout(150);
    return tag;
  }
  const option = name => `#hand-panel [data-hand-action="page"][data-value="${name}"]`;
  const close = '#hand-panel header [data-hand-action="close"]';
  await select('#hand-try');
  await page.waitForFunction(() => window.clayPlayDebug.getState().faceReady);
  await select('#hand-more');
  assert.equal((await state()).trying,true);
  await select(option('colors'));
  const swatch = '#hand-panel [data-hand-action="color"][data-value="#cd6e45"]';
  const sage = '#hand-panel [data-hand-action="color"]:text-is("Sage")';
  const sageHex = await page.locator(sage).getAttribute('data-value');
  const tag = await select(sage);
  assert.equal(await page.evaluate(() => '#' + window.clayPlayDebug.objects.active.material.color.getHexString()),sageHex);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(tag => window.handClicks.filter(value=>value===tag).length,tag),1,'Stationary finger activates only once');
  await select(swatch);
  await select('#hand-panel [data-hand-action="smoothness-step"][data-value="10"]');
  assert.equal((await state()).trying,true);
  await select(close);
  await page.evaluate(() => {window.testDelays.face = 100; window.testHands = [];});
  await page.waitForFunction(() => document.querySelector('.hand-ui-cursor').hidden);
  await page.waitForFunction(() => window.clayPlayDebug.getState().wearing);
  await select('#hand-more'); await select(close);
  await page.evaluate(() => window.testFaceVisible = false);
  await page.waitForFunction(() => !window.clayPlayDebug.getState().wearing);
  await select('#hand-more'); await select(close);
  await select('#hand-try-done');
  assert.equal((await state()).trying,false);
  assert.deepEqual(await geometry(),original,'Try On UI never deforms the mask');
  // Switch modes while a hand inference is pending. No second hand job may start.
  await page.waitForFunction(() => window.inferences.some(s=>s.task==='hand'&&s.active));
  await page.locator('#hand-try').click();
  await page.waitForFunction(() => window.clayPlayDebug.getState().faceReady);
  await select('#hand-try-done');
  await select('#tool-erase'); assert.equal((await state()).tool,'erase');
  await select('#tool-pinch'); assert.equal((await state()).tool,'pinch');
  const stats = await page.evaluate(() => window.inferences);
  assert.ok(stats.every(s=>s.peak<=1),'Each model has at most one inference in flight');
  assert.equal(stats.filter(s=>s.task==='hand').length,1,'Try On reuses the hand tracker');
  assert.ok(stats.filter(s=>s.task==='face').every(s=>s.frames>0),'Face tracking also advances');
  await page.locator('#hand-try').click();
  await page.waitForFunction(() => window.clayPlayDebug.getState().faceReady);
  await select('#hand-more');
  await select('#hand-panel [data-hand-action="camera-off"]');
  await select('#hand-panel [data-hand-action="confirm"]');
  assert.equal((await state()).cameraOn,false);
  assert.equal((await state()).trying,false);
  assert.equal(await page.locator('.hand-ui-cursor').isVisible(),false,'Camera shutdown clears the pointer');
  const handFrames = await page.evaluate(() => window.inferences.filter(s=>s.task==='hand').reduce((n,s)=>n+s.frames,0));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.inferences.filter(s=>s.task==='hand').reduce((n,s)=>n+s.frames,0)),handFrames,'Shutdown stops new hand jobs');
  await page.screenshot({path:'artifacts/try-on-hand-ui.jpg'});
  console.log('Try On hand UI passed: slow face inference, More, color/finish, single activation, hand/face loss, Back to creating, pending-frame transitions, normal tool selection, and camera shutdown.');
};

if (require.main === module) {
  (async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
    const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge'});
    try {
      const page = await browser.newPage({viewport:{width:1600,height:1100}}), errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await module.exports(page); assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
