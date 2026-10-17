const assert = require('node:assert/strict');

module.exports = async function(page) {
  await page.addInitScript(() => {
    window.testHands = []; window.testLabels = []; window.testDuration = 5;
    window.trackingFrames = 0; window.trackingWorkers = 0; window.pullCommitDelay = 650;
    const RealWorker = window.Worker;
    window.Worker = function(url, options) {
      if (!String(url).includes('trackingWorker')) {
        const worker = new RealWorker(url, options);
        if (/pullWorker|eraseWorker/.test(String(url))) {
          Object.defineProperty(worker, 'onmessage', { set(callback) {
            RealWorker.prototype.__lookupSetter__('onmessage').call(worker, event => {
              if (event.data.final || event.data.edits) setTimeout(() => callback(event), window.pullCommitDelay);
              else callback(event);
            });
          }});
        }
        return worker;
      }
      window.trackingWorkers++;
      return { closed: false, count: 1, postMessage(data) {
        if (data.type === 'init' || data.type === 'configure') this.count = data.numHands ?? 1;
        data.bitmap?.close();
        const duration = window.testDuration;
        const error = data.type === 'frame' && window.failTrackingFrame ? 'Simulated tracking interruption' : undefined;
        if (error) window.failTrackingFrame = false;
        const result = data.type === 'frame' ? { landmarks: structuredClone(window.testHands.slice(0, this.count)),
          handedness: window.testHands.slice(0, this.count).map((_, i) => [{ categoryName: window.testLabels[i] || (i ? 'Right' : 'Left') }]) } : true;
        if (data.type === 'frame') window.trackingFrames++;
        setTimeout(() => { if (!this.closed) this.onmessage?.({ data: { id: data.id, result, error, duration: data.type === 'frame' ? duration : undefined } }); }, data.type === 'frame' ? duration : 1);
      }, terminate() { this.closed = true; } };
    };
    window.Worker.prototype = RealWorker.prototype;
    const bitmap = window.createImageBitmap;
    window.createImageBitmap = (source, ...args) => source instanceof HTMLVideoElement ? Promise.resolve({ close() {} }) : bitmap(source, ...args);
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const ctx = c.getContext('2d'); let frame = 0;
      const draw = () => { ctx.fillStyle = ++frame % 2 ? '#bcc4ce' : '#bdc5cf'; ctx.fillRect(0, 0, c.width, c.height); };
      draw(); setInterval(draw, 33); return c.captureStream(30);
    };
    window.resizeHand = (x, y, pose = 'fist') => {
      const p = Array.from({ length: 21 }, () => ({ x, y: y + .08, z: 0 }));
      p[0].y = y + .2; p[5] = { x: x - .05, y: y + .1, z: 0 };
      p[9].y = y + .09; p[13] = { x: x + .04, y: y + .1, z: 0 }; p[17] = { x: x + .08, y: y + .12, z: 0 };
      for (const [joint, tip, dx] of [[6,8,0], [10,12,.025], [14,16,.06], [18,20,.095]]) {
        p[joint] = { x: x + dx, y: y + .06, z: 0 };
        p[tip] = { x: x + dx, y: y + (pose === 'fist' ? .14 : 0), z: 0 };
      }
      p[4] = { x: x + (pose === 'pinch' ? .003 : -.08), y, z: 0 };
      return p;
    };
  });
  await page.goto(process.env.CLAYPLAY_TEST_URL || 'http://127.0.0.1:5174/?diagnostics');
  const state = () => page.evaluate(() => window.clayPlayDebug.getState());
  const idle = () => page.waitForFunction(() => window.clayPlayDebug && !window.clayPlayDebug.getState().pending && !window.clayPlayDebug.getState().pulling && !window.clayPlayDebug.getState().erasing);
  const geometry = () => page.evaluate(() => {
    let count = 0, sum = 0;
    for (const { mesh } of window.clayPlayDebug.objects.active.volume.bricks.values()) for (const value of mesh.geometry.attributes.position.array) sum += value * (++count % 31 + 1);
    return {count, sum};
  });
  await idle(); const original = await geometry();
  await page.locator('#camera-button').click();
  await page.waitForFunction(() => window.clayPlayDebug.getState().handCount === 2 && !document.querySelector('#camera-button').disabled);
  await page.locator('#studio-message-ok').click();
  await page.waitForFunction(() => window.clayPlayDebug.getState().arLive);
  if (await page.locator('#tutorial-skip').isVisible()) await page.locator('#tutorial-skip').click();
  const pair = (a, b, pose = 'fist') => page.evaluate(({a,b,pose}) => {
    window.testHands = [window.resizeHand(a, .32, pose), window.resizeHand(b, .32, pose)]; window.testLabels = ['Left', 'Right'];
  }, {a,b,pose});
  await pair(.32, .68, 'open');
  await page.waitForFunction(() => /Both hands detected.*close both fists/.test(document.querySelector('#scene-hint').textContent));
  assert.equal((await state()).resizing, false); assert.equal((await state()).detectedHands, 2);
  // A slow burst used to permanently recreate the tracker with numHands: 1.
  const start = await page.evaluate(() => { window.testDuration = 150; return window.trackingFrames; });
  await page.waitForFunction(start => window.trackingFrames >= start + 9, start);
  assert.equal((await state()).handCount, 2); assert.equal((await state()).resizeAutoPaused, false);
  assert.equal(await page.evaluate(() => window.trackingWorkers), 1);
  assert.ok((await state()).trackingInterval > 120);
  await pair(.32, .68); await page.waitForFunction(() => window.clayPlayDebug.getState().resizing);
  await pair(.22, .78); await page.waitForFunction(() => window.clayPlayDebug.getState().maskScale > 1.3);
  await pair(.22, .78, 'open'); await page.waitForFunction(() => !window.clayPlayDebug.getState().resizing);
  const firstSize = (await state()).maskScale;
  await page.waitForTimeout(200); assert.equal((await state()).maskScale, firstSize);
  await page.evaluate(() => { window.testHands = []; window.testDuration = 5; });
  await page.locator('#sculpt-undo').click(); assert.equal((await state()).maskScale, 1);
  await page.waitForTimeout(750);
  const targetAt = (x, y) => page.evaluate(({x,y}) => {
    const d = window.clayPlayDebug, p = new d.camera.position.constructor(x, y, .4);
    d.objects.active.group.localToWorld(p); p.project(d.camera);
    const b = document.querySelector('#stage').getBoundingClientRect(), video = document.querySelector('#camera-video');
    const sx = Math.max(1, (video.videoWidth / video.videoHeight) / (b.width / b.height));
    const sy = Math.max(1, (b.width / b.height) / (video.videoWidth / video.videoHeight));
    return { x: 1 - ((p.x + 1) / 2 + (sx - 1) / 2) / sx, y: ((1 - p.y) / 2 + (sy - 1) / 2) / sy };
  }, {x,y});
  const target = await targetAt(.6, .6);
  const single = (offset, pose) => page.evaluate(({target,offset,pose}) => {
    window.testHands = [window.resizeHand(target.x + offset, target.y, pose)]; window.testLabels = ['Left'];
  }, {target,offset,pose});
  await single(0, 'open'); await page.waitForTimeout(250);
  await single(0, 'pinch'); await page.waitForFunction(() => window.clayPlayDebug.getState().grabbed);
  await single(-.045, 'pinch');
  await page.waitForFunction(() => Math.hypot(...window.clayPlayDebug.objects.active.volume.surfacePull.lastWarp.delta) > .1);
  const measuredWarp = await page.evaluate(() => window.clayPlayDebug.objects.active.volume.surfacePull.lastWarp.delta);
  // Go straight from a held deformation to two fists, with no open-pinch frame.
  await pair(.32, .68);
  await page.waitForFunction(() => window.clayPlayDebug.getState().resizeEnabled && window.clayPlayDebug.getState().pulling && !window.clayPlayDebug.getState().grabbed);
  assert.equal((await state()).resizing, false); assert.equal((await state()).maskScale, 1);
  assert.match(await page.locator('#scene-hint').textContent(), /Keeping your edit.*keep both fists/);
  const heldWarp = await page.evaluate(() => window.clayPlayDebug.objects.active.volume.surfacePull.lastWarp.delta);
  assert.ok(Math.hypot(...heldWarp.map((v,i)=>v-measuredWarp[i])) < .01, 'Fist coordinates cannot become a new deformation target');
  await page.waitForFunction(() => window.clayPlayDebug.getState().resizing && !window.clayPlayDebug.getState().pulling);
  assert.deepEqual(await page.evaluate(() => window.clayPlayDebug.objects.active.volume.pullWarp.delta), heldWarp, 'Transition commits only the final measured pinch');
  const deformed = await geometry(); assert.notDeepEqual(deformed, original);
  await pair(.22, .78); await page.waitForFunction(() => window.clayPlayDebug.getState().maskScale > 1.3);
  await pair(.22, .78, 'open'); await page.waitForFunction(() => !window.clayPlayDebug.getState().resizing);
  const kept = (await state()).maskScale; assert.deepEqual(await geometry(), deformed);
  await page.waitForTimeout(150); assert.equal((await state()).maskScale, kept);
  await page.evaluate(() => window.testHands = []);
  await page.locator('#sculpt-undo').click(); assert.equal((await state()).maskScale, 1); assert.deepEqual(await geometry(), deformed);
  await page.locator('#sculpt-undo').click(); assert.deepEqual(await geometry(), original);
  await page.locator('#sculpt-redo').click(); assert.deepEqual(await geometry(), deformed);
  await page.locator('#sculpt-redo').click(); assert.equal((await state()).maskScale, kept);
  // Repeated resizing after deformation keeps the geometry and gesture usable.
  for (let i = 0; i < 2; i++) {
    await pair(.32, .68); await page.waitForFunction(() => window.clayPlayDebug.getState().resizing);
    await pair(.38, .62); await page.waitForFunction(s => window.clayPlayDebug.getState().maskScale < s * .85, (await state()).maskScale);
    await page.evaluate(() => window.testHands = [window.resizeHand(.38, .32)]);
    await page.waitForFunction(() => !window.clayPlayDebug.getState().resizeEnabled);
    const frozen = (await state()).maskScale;
    await page.waitForTimeout(200); assert.equal((await state()).maskScale, frozen); assert.equal((await state()).moving, false);
    assert.deepEqual(await geometry(), deformed);
  }
  // Erasing has its own worker and must finish before a size checkpoint.
  await page.evaluate(() => window.testHands = []);
  await page.locator('#tool-erase').click();
  Object.assign(target, await targetAt(0, -.4));
  await single(0, 'open'); await page.waitForTimeout(250);
  await single(0, 'pinch'); await page.waitForFunction(() => window.clayPlayDebug.getState().eraseHeld);
  await single(-.025, 'pinch'); await page.waitForTimeout(100);
  await pair(.32, .68);
  await page.waitForFunction(() => window.clayPlayDebug.getState().resizeEnabled && window.clayPlayDebug.getState().erasing && !window.clayPlayDebug.getState().eraseHeld);
  const beforeEraseResize = (await state()).maskScale;
  assert.equal((await state()).resizing, false);
  await page.waitForFunction(() => !window.clayPlayDebug.getState().erasing && window.clayPlayDebug.getState().resizing);
  const erased = await geometry(); assert.notDeepEqual(erased, deformed);
  await pair(.22, .78); await page.waitForFunction(s => window.clayPlayDebug.getState().maskScale > s * 1.2, beforeEraseResize);
  await pair(.22, .78, 'open'); await page.waitForFunction(() => !window.clayPlayDebug.getState().resizing);
  assert.deepEqual(await geometry(), erased);
  await page.evaluate(() => window.testHands = []);
  await page.locator('#sculpt-undo').click(); assert.equal((await state()).maskScale, beforeEraseResize);
  await page.locator('#sculpt-undo').click(); assert.deepEqual(await geometry(), deformed);
  // Reconnection must request two hands in compatibility mode as well.
  assert.equal((await state()).trackingMode, 'worker');
  await page.evaluate(async () => {
    // Use the same module instance as main.js, including Vite's HMR query.
    const moduleURL = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/trackingClient.js').name;
    const {TrackingClient} = await import(moduleURL);
    window.recoveryCounts = [];
    TrackingClient.createCompatibility = async () => ({mode:'compatibility', handCount:1, duration:5, minInterval:33,
      async setHandCount(count) { this.handCount=count; window.recoveryCounts.push(count); }, close() {},
      async detectForVideo() {
        await new Promise(r=>setTimeout(r,5));
        return {landmarks:structuredClone(window.testHands.slice(0,this.handCount)), handedness:window.testHands.slice(0,this.handCount).map((_,i)=>[{categoryName:i?'Right':'Left'}])};
      }});
    window.failTrackingFrame = true;
  });
  await page.waitForFunction(() => window.clayPlayDebug.getState().trackingMode === 'compatibility' && !document.querySelector('#camera-button').disabled);
  assert.equal((await state()).handCount, 2); assert.equal((await state()).resizeAutoPaused, false);
  assert.deepEqual(await page.evaluate(() => window.recoveryCounts), [2]);
  await pair(.32, .68); await page.waitForFunction(() => window.clayPlayDebug.getState().resizing);
  assert.deepEqual(await geometry(), deformed);
  await page.screenshot({path:'artifacts/resize-after-sculpt/fixed.jpg'});
  console.log('Resize after sculpt passed: two-hand guidance, slow inference without disabling detection, pinch/erase→two-fist handoff, delayed commits, exact history, repeated resizing, one-hand loss freeze, and two-hand compatibility recovery.');
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
