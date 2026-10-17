// Camera delay and missing detections are different. A newly returned,
// timestamped result can be useful even when the camera/inference took >200ms.
export const HAND_SOURCE_MAX_AGE_MS = 500;
export const HAND_RESULT_GAP_MS = 300;

export function usableHandSample(sampleAt, receivedAt) {
  const age = receivedAt - sampleAt;
  return Number.isFinite(age) && age >= 0 && age < HAND_SOURCE_MAX_AGE_MS;
}

export function currentHandPose(receivedAt, now) {
  const gap = now - receivedAt;
  return Number.isFinite(gap) && gap >= 0 && gap < HAND_RESULT_GAP_MS;
}
