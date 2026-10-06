import { ClayVolume } from './clayVolume.js';

self.onmessage = ({ data }) => {
  try {
    const volume = ClayVolume.fromState(data.state ?? data);
    const { n, d } = data;
    let positive = 0, negative = 0;
    // Estimate actual occupied volume on each side, including prior sculpting.
    const step = 0.075;
    for (let z = -2.4 + step / 2; z < 2.4; z += step)
      for (let y = -2.4 + step / 2; y < 2.4; y += step)
        for (let x = -2.4 + step / 2; x < 2.4; x += step) {
          if (volume.sample(x, y, z) >= 0) continue;
          if (n[0] * x + n[1] * y + n[2] * z + d > 0) positive++;
          else negative++;
        }
    if (Math.min(positive, negative) < 3) { self.postMessage({ cut: null }); return; }
    // max(clay, plane) keeps the negative half-space; remove the smaller side.
    const sign = positive <= negative ? 1 : -1;
    self.postMessage({ cut: { n: n.map((v) => v * sign), d: d * sign }, removed: Math.min(positive, negative) / (positive + negative) });
  } catch (error) { self.postMessage({ error: error.message }); }
};
