export const visionRuntime = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

export function trackingOptions(task) {
  const face = task === 'face';
  // CPU inference in the worker keeps the face model from competing with
  // the studio renderer for GPU inference. Hand sculpting retains its GPU path.
  return {
    baseOptions: { modelAssetPath: face
      ? 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
      : 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: face ? 'CPU' : 'GPU' },
    runningMode: 'VIDEO',
    ...(face ? { numFaces: 1, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false }
      : { numHands: 1, minHandDetectionConfidence: 0.52, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.48 }),
  };
}
