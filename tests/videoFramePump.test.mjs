import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoFramePump } from '../src/videoFramePump.js';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture({ fallback = false, interval = 0 } = {}) {
  let clock = 0, next = 0;
  const callbacks = new Map(), watchdogs = new Map(), timers = new Map(), consumed = [], resolvers = [];
  const request = callback => { callbacks.set(++next, callback); return next; };
  const cancel = id => callbacks.delete(id);
  const video = { readyState: 2, currentTime: 0 };
  if (!fallback) Object.assign(video, { requestVideoFrameCallback: request, cancelVideoFrameCallback: cancel });
  const pump = new VideoFramePump(video, frame => { consumed.push(frame); return new Promise(resolve => resolvers.push(resolve)); }, {
    now: () => clock, interval: () => interval,
    raf: fallback ? request : callback => { watchdogs.set(++next, callback); return next; },
    caf: fallback ? cancel : id => watchdogs.delete(id),
    delay: (fn, wait) => { timers.set(++next, { fn, at: clock + wait }); return next; }, cancelDelay: id => timers.delete(id),
  });
  const frame = (at, mediaTime, extra = {}) => {
    clock = at; video.currentTime = mediaTime;
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id); callback(clock, fallback ? undefined : { mediaTime, presentationTime: at - 2, ...extra });
  };
  const advance = at => { clock = at; for (const [id, timer] of timers) if (timer.at <= at) { timers.delete(id); timer.fn(); } };
  const watchdog = (at, mediaTime) => {
    clock = at; video.currentTime = mediaTime;
    const [id, callback] = watchdogs.entries().next().value;
    watchdogs.delete(id); callback(clock);
  };
  return { pump, frame, advance, watchdog, consumed, resolvers, callbacks, timers, video, watchdogs };
}

test('Slow inference skips intermediate frames and immediately consumes only the latest', async () => {
  const f = fixture(); f.pump.start();
  f.frame(0, 0); f.frame(16, .016); f.frame(32, .032); f.frame(48, .048);
  assert.equal(f.consumed.length, 1, 'Only one inference may be in flight');
  f.resolvers.shift()(true); await flush();
  assert.deepEqual(f.consumed.map(x => x.mediaTime), [0, .048]);
  f.resolvers.shift()(true); await flush();
  assert.equal(f.consumed.length, 2, 'Never infer the same frame twice');
  f.pump.stop();
});

test('Backoff wakes at its deadline using the latest frame rather than an extra display tick', async () => {
  const f = fixture({ interval: 33 }); f.pump.start();
  f.frame(0, 0); f.resolvers.shift()(true); await flush();
  f.frame(16, .016); f.frame(32, .032);
  assert.equal(f.consumed.length, 1);
  f.advance(33);
  assert.equal(f.consumed.length, 2); assert.equal(f.consumed[1].mediaTime, .032);
  f.pump.stop(); f.resolvers.shift()(true); await flush();
  assert.equal(f.callbacks.size, 0); assert.equal(f.timers.size, 0);
});

test('Shutdown during inference cannot schedule another capture or replay stale frames', async () => {
  const f = fixture(); f.pump.start(); f.frame(0, 0); f.frame(33, .033);
  f.pump.stop(); f.resolvers.shift()(true); await flush();
  assert.equal(f.consumed.length, 1); assert.equal(f.callbacks.size, 0);
  const stale = fixture(); stale.pump.start(); stale.frame(0, 0); stale.frame(33, .033);
  stale.advance(200); stale.resolvers.shift()(true); await flush();
  assert.equal(stale.consumed.length, 1, 'Wait for a new frame after a long stall');
  stale.pump.stop();
});

test('Capture clock metadata is preserved; unsupported browsers fall back without duplicate inference', async () => {
  const f = fixture(); f.pump.start(); f.frame(100, .1, { captureTime: 75 });
  assert.equal(f.consumed[0].sampleAt, 75); assert.equal(f.consumed[0].timingSource, 'capture');
  f.pump.stop(); f.resolvers.shift()(true); await flush();
  const fallback = fixture({ fallback: true }); fallback.pump.start(); fallback.frame(100, .1);
  assert.equal(fallback.consumed[0].sampleAt, 100); assert.equal(fallback.consumed[0].timingSource, 'callback');
  fallback.resolvers.shift()(true); await flush(); fallback.frame(116, .1);
  assert.equal(fallback.consumed.length, 1);
  fallback.pump.stop();
});

test('Restarting while an old inference finishes keeps the new schedule single-flight', async () => {
  const f = fixture(); f.pump.start(); f.frame(0, 0);
  f.pump.stop(); f.pump.start(); f.frame(33, .033);
  assert.equal(f.consumed.length, 1);
  f.resolvers.shift()(false); await flush();
  assert.equal(f.consumed.length, 2, 'Old completion cannot stop the restarted schedule');
  assert.equal(f.pump.stopped, false);
  f.pump.stop(); f.resolvers.shift()(true); await flush();
});

test('Hidden camera previews continue tracking when the browser suppresses video callbacks', async () => {
  const f = fixture(); f.pump.start();
  f.watchdog(110, .1);
  assert.equal(f.consumed.length, 1); assert.equal(f.consumed[0].timingSource, 'callback');
  f.resolvers.shift()(true); await flush(); f.watchdog(143, .133);
  assert.equal(f.consumed.length, 2);
  f.resolvers.shift()(true); await flush();
  f.frame(150, .133);
  assert.equal(f.consumed.length, 2, 'Resuming video callbacks must not duplicate the watchdog frame');
  f.watchdog(166, .166);
  assert.equal(f.consumed.length, 2, 'Watchdog stays idle while video callbacks are healthy');
  f.pump.stop(); assert.equal(f.watchdogs.size, 0); assert.equal(f.callbacks.size, 0);
});

test('Default scheduling calls browser animation APIs with the global receiver', t => {
  const previousRAF = globalThis.requestAnimationFrame, previousCAF = globalThis.cancelAnimationFrame;
  t.after(() => { globalThis.requestAnimationFrame = previousRAF; globalThis.cancelAnimationFrame = previousCAF; });
  let requested = false, cancelled = false;
  globalThis.requestAnimationFrame = function() { assert.equal(this, globalThis); requested = true; return 1; };
  globalThis.cancelAnimationFrame = function(id) { assert.equal(this, globalThis); assert.equal(id, 1); cancelled = true; };
  const pump = new VideoFramePump({ readyState: 2, currentTime: 0 }, () => true);
  pump.start(); pump.stop(); assert.ok(requested && cancelled);
});
