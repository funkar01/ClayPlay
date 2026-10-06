import { trackingOptions, visionRuntime } from './trackingOptions.js';
const preferCompatibility = new Set();

export class TrackingClient {
  constructor(task = 'hand') {
    this.task = task;
    this.minInterval = task === 'face' ? 33 : 0;
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
  static async create(task = 'hand', signal) {
    if (signal?.aborted) throw new DOMException('Tracking canceled', 'AbortError');
    if (preferCompatibility.has(task)) return CompatibilityTracker.create(task, signal);
    let client;
    const abort = () => client?.close(new DOMException('Tracking canceled', 'AbortError'));
    try {
      client = new TrackingClient(task);
      signal?.addEventListener('abort', abort, { once: true });
      await client.request('init', { task });
      return client;
    } catch (error) {
      client?.close();
      if (signal?.aborted) throw new DOMException('Tracking canceled', 'AbortError');
      console.warn('Background tracking unavailable; using compatibility mode:', error);
      try { return await TrackingClient.createCompatibility(task, signal); }
      catch (fallbackError) {
        throw new Error(`Background tracking: ${error.message}. Compatibility tracking: ${fallbackError.message}`);
      }
    } finally { signal?.removeEventListener('abort', abort); }
  }

  static async createCompatibility(task = 'hand', signal) {
    // Avoid repeatedly selecting a worker that failed during this page session.
    preferCompatibility.add(task);
    return CompatibilityTracker.create(task, signal);
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
  static async create(task = 'hand', signal) {
    const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(visionRuntime);
    const options = trackingOptions(task), Tracker = task === 'face' ? FaceLandmarker : HandLandmarker;
    if (signal?.aborted) throw new DOMException('Tracking canceled', 'AbortError');
    let tracker;
    try { tracker = await Tracker.createFromOptions(vision, options); }
    catch (error) {
      if (signal?.aborted) throw new DOMException('Tracking canceled', 'AbortError');
      if (options.baseOptions.delegate === 'CPU') throw error;
      options.baseOptions.delegate = 'CPU'; tracker = await Tracker.createFromOptions(vision, options);
    }
    if (signal?.aborted) { tracker.close(); throw new DOMException('Tracking canceled', 'AbortError'); }
    return new CompatibilityTracker(tracker);
  }
}
