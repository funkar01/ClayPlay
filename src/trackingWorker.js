import { FilesetResolver, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';
import { trackingOptions, visionRuntime } from './trackingOptions.js';

let tracker;
self.onmessage = async ({ data }) => {
  const { id, type, bitmap, timestamp } = data;
  try {
    if (type === 'init') {
      // Module workers cannot execute the classic runtime with importScripts.
      // Select MediaPipe's ES-module runtime, which exports ModuleFactory.
      const vision = await FilesetResolver.forVisionTasks(visionRuntime, true);
      const options = trackingOptions(data.task);
      const Tracker = data.task === 'face' ? FaceLandmarker : HandLandmarker;
      try { tracker = await Tracker.createFromOptions(vision, options); }
      catch (error) {
        if (options.baseOptions.delegate === 'CPU') throw error;
        options.baseOptions.delegate = 'CPU'; tracker = await Tracker.createFromOptions(vision, options);
      }
      self.postMessage({ id, result: true });
    } else {
      const start = performance.now();
      const result = tracker.detectForVideo(bitmap, timestamp);
      self.postMessage({ id, result, duration: performance.now() - start });
    }
  } catch (error) { self.postMessage({ id, error: error.message ?? String(error), errorName: error.name, stack: error.stack }); }
  finally { bitmap?.close(); }
};
