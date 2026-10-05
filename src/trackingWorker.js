import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let tracker;
self.onmessage = async ({ data }) => {
  const { id, type, bitmap, timestamp } = data;
  try {
    if (type === 'init') {
      // Module workers cannot execute the classic runtime with importScripts.
      // Select MediaPipe's ES-module runtime, which exports ModuleFactory.
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm', true);
      const options = {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.52, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.48,
      };
      try { tracker = await HandLandmarker.createFromOptions(vision, options); }
      catch { options.baseOptions.delegate = 'CPU'; tracker = await HandLandmarker.createFromOptions(vision, options); }
      self.postMessage({ id, result: true });
    } else {
      const start = performance.now();
      const result = tracker.detectForVideo(bitmap, timestamp);
      self.postMessage({ id, result, duration: performance.now() - start });
    }
  } catch (error) { self.postMessage({ id, error: error.message ?? String(error), errorName: error.name, stack: error.stack }); }
  finally { bitmap?.close(); }
};
