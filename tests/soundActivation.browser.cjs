const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/bhanu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: true } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=user-gesture-required'] });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.audioChecks = [];
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(...args) {
          super(...args);
          const c = this, analyser = c.createAnalyser(); analyser.fftSize = 1024;
          analyser.connect(c.destination);
          const check = { context: c, analyser, notes: 0 }; window.audioChecks.push(check);
          const createGain = c.createGain.bind(c), createOscillator = c.createOscillator.bind(c);
          c.createGain = () => {
            const gain = createGain(), connect = gain.connect.bind(gain);
            gain.connect = target => connect(target === c.destination ? analyser : target);
            return gain;
          };
          c.createOscillator = () => { check.notes++; return createOscillator(); };
        }
      };
    });
    await page.goto('http://127.0.0.1:5176/');
    // This setup card stops pointerdown propagation just like the camera button.
    await page.locator('.comfort-skip').click();
    await page.waitForFunction(() => window.audioChecks.some(c => c.context.state === 'running'));
    const results = [];
    for (const tool of ['pull', 'extrude', 'erase']) {
      const result = await page.evaluate(async tool => {
        // Visible hands-only sessions should not require document.hasFocus().
        document.hasFocus = () => false;
        const check = window.audioChecks[0], before = check.notes;
        const event = new Event('studio-edit-committed');event.tool = tool;event.intensity = .8;
        document.dispatchEvent(event);
        let peak = 0;
        const buffer = new Float32Array(check.analyser.fftSize);
        for (let i = 0; i < 12; i++) {
          await new Promise(resolve => setTimeout(resolve, 12));
          check.analyser.getFloatTimeDomainData(buffer);
          for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
        }
        return { tool, notes: check.notes - before, peak, state: check.context.state };
      }, tool);
      assert.equal(result.notes, 1, `${tool} should create exactly one note`);
      assert.ok(result.peak > .001, `${tool} must produce a non-silent audio signal`);
      results.push(result);
      await page.waitForTimeout(250);
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
