// Keep inference single-flight. While it runs, retain only the newest frame's
// metadata; create the bitmap only when the consumer can actually use it.
export class VideoFramePump {
  constructor(video, consume, { interval = () => 0, canRun = () => true,
    now = () => performance.now(),
    raf = callback => globalThis.requestAnimationFrame(callback),
    caf = id => globalThis.cancelAnimationFrame(id),
    delay = (callback, ms) => globalThis.setTimeout(callback, ms),
    cancelDelay = id => globalThis.clearTimeout(id), onError = console.error } = {}) {
    Object.assign(this, { video, consume, interval, canRun, now, raf, caf, delay, cancelDelay, onError });
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation = (this.generation ?? 0) + 1;
    this.latest = null; this.lastMediaTime = -1; this.lastStart = -Infinity;
    this.lastVideoCallbackAt = this.now();
    this.scheduleFrame();
    if (this.videoCallbacks) this.scheduleWatchdog();
  }

  scheduleFrame() {
    if (this.stopped) return;
    const receive = (now, metadata) => {
      this.frameId = null;
      if (this.stopped) return;
      if (metadata) this.lastVideoCallbackAt = now;
      this.scheduleFrame();
      this.receiveFrame(now, metadata);
    };
    this.videoCallbacks = typeof this.video.requestVideoFrameCallback === 'function';
    this.frameId = this.videoCallbacks ? this.video.requestVideoFrameCallback(receive) : this.raf(receive);
  }

  receiveFrame(now, metadata) {
    const mediaTime = metadata?.mediaTime ?? this.video.currentTime;
    // Decode counts also deduplicate across the video-callback/watchdog paths.
    const decoded = this.video.getVideoPlaybackQuality?.().totalVideoFrames;
    const key = decoded > 0 ? `decoded:${decoded}` : mediaTime;
    if (this.video.readyState >= 2 && key !== this.latest?.key) {
      // captureTime is not exposed by every browser for local webcams.
      // Presentation time is a lower bound on the frame's real age.
      const captured = Number.isFinite(metadata?.captureTime);
      this.latest = { mediaTime, key, availableAt: now,
        sampleAt: captured ? metadata.captureTime : (metadata?.presentationTime ?? now),
        timingSource: captured ? 'capture' : metadata ? 'presentation' : 'callback' };
    }
    this.pump();
  }

  scheduleWatchdog() {
    this.watchdogId = this.raf(now => {
      this.watchdogId = null;
      if (this.stopped) return;
      // Fullscreen hides the preview. Some browsers then suppress rVFC even
      // though the stream and bitmap capture continue to provide fresh frames.
      if (now - this.lastVideoCallbackAt >= 100) this.receiveFrame(now);
      this.scheduleWatchdog();
    });
  }

  pump() {
    if (this.stopped || this.busy || !this.latest || !this.canRun()
      || this.latest.key === this.lastMediaTime || this.now() - this.latest.availableAt > 100) return;
    const wait = this.lastStart + this.interval() - this.now();
    if (wait > 0) {
      if (this.timer == null) this.timer = this.delay(() => { this.timer = null; this.pump(); }, wait);
      return;
    }
    this.cancelDelay(this.timer); this.timer = null;
    const frame = this.latest;
    const generation = this.generation;
    this.lastMediaTime = frame.key; this.lastStart = this.now(); this.busy = true;
    // Invoke immediately so the snapshot matches the available video frame.
    let work;
    try { work = this.consume(frame); }
    catch (error) { this.busy = false; this.stop(); this.onError(error); return; }
    Promise.resolve(work).then(keepGoing => {
      this.busy = false;
      if (generation !== this.generation) { this.pump(); return; }
      if (keepGoing === false) this.stop();
      else this.pump();
    }, error => {
      this.busy = false;
      if (generation !== this.generation) { this.pump(); return; }
      this.stop(); this.onError(error);
    });
  }

  stop() {
    this.stopped = true;
    if (this.frameId != null) {
      if (this.videoCallbacks) this.video.cancelVideoFrameCallback(this.frameId);
      else this.caf(this.frameId);
    }
    this.cancelDelay(this.timer);
    if (this.watchdogId != null) this.caf(this.watchdogId);
    this.watchdogId = null;
    this.frameId = null; this.timer = null; this.latest = null;
  }
}
