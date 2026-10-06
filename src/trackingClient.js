let preferCompatibility = false;

export class TrackingClient {
  constructor() {
    this.mode = 'worker';
    this.worker = new Worker(new URL('./trackingWorker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.sequence = 0;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      clearTimeout(request.timer);
      this.duration = data.duration ?? 0;
      if (data.error) {
        const error = new Error(data.error);
        error.name = data.errorName ?? 'Error';
        if (data.stack) error.stack = data.stack;
        request.reject(error);
      } else request.resolve(data.result);
    };
    this.worker.onerror = (event) => this.close(new Error(event.message || 'Tracking worker failed'));
  }
  request(type, extra = {}, transfer = []) {
    if (this.closed) return Promise.reject(new Error('Tracking stopped'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.close(new Error('Tracking worker timed out')), type === 'init' ? 60000 : 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...extra }, transfer);
    });
  }
  async detectForVideo(video, timestamp) {
    const width = Math.min(640, video.videoWidth);
    const bitmap = await createImageBitmap(video, { resizeWidth: width,
      resizeHeight: Math.max(1, Math.round(video.videoHeight * width / video.videoWidth)), resizeQuality: 'low' });
    if (this.closed) { bitmap.close(); throw new Error('Tracking stopped'); }
    return this.request('frame', { bitmap, timestamp }, [bitmap]);
  }
  close(error = new Error('Tracking stopped')) {
    this.closed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  static async create() {
    if (preferCompatibility) return CompatibilityTracker.create();
    let client;
    try {
      client = new TrackingClient();
      await client.request('init');
      return client;
    } catch (error) {
      client?.close();
      console.warn('Background tracking unavailable; using compatibility mode:', error);
      try { return await TrackingClient.createCompatibility(); }
      catch (fallbackError) {
        throw new Error(`Background tracking: ${error.message}. Compatibility tracking: ${fallbackError.message}`);
      }
    }
  }

  static async createCompatibility() {
    // Avoid repeatedly selecting a worker that failed during this page session.
    preferCompatibility = true;
    return CompatibilityTracker.create();
  }
}

// Preserve the previously working browser path if worker/WebGL setup fails.
class CompatibilityTracker {
  constructor(tracker) {
    this.tracker = tracker;
    this.mode = 'compatibility';
    this.minInterval = 33;
    this.duration = 0;
  }
  async detectForVideo(video, timestamp) {
    const start = performance.now();
    const result = this.tracker.detectForVideo(video, timestamp);
    this.duration = performance.now() - start;
    return result;
  }
  close() { this.tracker.close(); }
  static async create() {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
    const options = {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.52, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.48,
    };
    try { return new CompatibilityTracker(await HandLandmarker.createFromOptions(vision, options)); }
    catch { options.baseOptions.delegate = 'CPU'; return new CompatibilityTracker(await HandLandmarker.createFromOptions(vision, options)); }
  }
}
