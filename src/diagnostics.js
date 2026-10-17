export const diagnostics = { inferenceMs: 0, captureMs: 0, roundTripMs: 0, resultAgeMs: 0, frameTiming: 'callback', cameraHz: 0, trackingHz: 0, predictionMs: 0, pointerAgeMs: 0, poseAgeMs: 0, frameMs: 0, meshMs: 0, sculptMs: 0, pullWorkerMs: 0, pullInstallMs: 0, cutWorkerMs: 0, dropouts: 0, pinch: 'open', pause: 'setup', meshPending: 0 };
// Opt-in diagnostics leave the studio free of technical controls by default.
const enabled = typeof document !== 'undefined' && new URLSearchParams(location.search).has('diagnostics');
if (enabled) {
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:9999;background:#fffdf3ee;color:#46362a;padding:10px;font:12px monospace;pointer-events:none';
  document.body.append(panel);
  setInterval(() => { panel.textContent = Object.entries(diagnostics).map(([key,value]) => `${key}: ${typeof value === 'number' ? value.toFixed(1) : value}`).join('\n'); }, 300);
}
