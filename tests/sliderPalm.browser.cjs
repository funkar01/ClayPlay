// Replay a complete palm drag through the real slider input/cancellation path.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'C:/Users/bhanu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host:'127.0.0.1',port:5177,strictPort:true } });
  await server.listen();let browser;
  try {
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage({viewport:{width:1600,height:1000}}), errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:5177/?diagnostics');
    await page.waitForFunction(()=>window.clayPlayDebug && !window.clayPlayDebug.getState().pending);
    await page.locator('.comfort-skip').click();
    await page.locator('#tutorial-skip').click();
    await page.locator('#mask-picker-continue').click();
    await page.evaluate(()=>window.clayPlayDebug.setControlMode('palm'));
    await page.locator('#studio-size-tab').click();
    const states = await page.evaluate(async()=>{
      const {palmHand} = await import('/tests/helpers/palmHand.mjs');
      const debug=window.clayPlayDebug,input=document.querySelector('#tool-size');
      const rect=input.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();
      const x=rect.left+12+(Number(input.value)/90)*(rect.width-24),y=rect.top+rect.height/2;
      const start=performance.now();let frame=0;
      const feed=(closed,travel)=>{
        const dx=.15+.7*(1-(x+travel-stage.left)/stage.width)-.508;
        const dy=.15+.7*(y-stage.top)/stage.height-.53;
        const now=start+frame++*270;
        debug.feedHands([palmHand(closed,dx,dy)],now,{sampleAt:now-250});
        const state=debug.getState();
        return {value:Number(input.value),gesture:document.querySelector('.hand-ui-cursor').dataset.gesture,captured:state.handUICaptured,pulling:state.pulling};
      };
      return [feed(false,0),feed(false,0),feed(true,0),feed(true,0),
        ...[20,45,75,110,150,190,150,110].map(move=>feed(true,move)),feed(false,110),feed(false,0)];
    });
    assert.equal(states[3].gesture,'held','closing over the slider acquires a grip');
    const rising=states.slice(4,10);
    assert.ok(rising.filter((s,i)=>i===0 || s.value>rising[i-1].value).length>=5,'values must keep increasing after the first input event');
    assert.ok(rising.at(-1).value>states[3].value+40,'a long drag must cover most of the range');
    assert.ok(states[11].value<states[9].value,'the same grip can reverse direction');
    assert.equal(states[12].value,states[11].value,'opening must not add a final jump');
    assert.equal(states[13].value,states[12].value,'open-hand motion keeps the chosen value');
    assert.ok(states.every(s=>!s.pulling),'adjusting size must not deform the mask');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'palm slider drags continuously and releases cleanly',states},null,2));
  } finally { await browser?.close();await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
