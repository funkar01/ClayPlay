// Increase HSL saturation by 30%, preserving each palette color's hue and
// lightness. Clamp at full saturation so pale colors keep their character.
function intensify(hex) {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const high = Math.max(...rgb), low = Math.min(...rgb);
  const lightness = (high + low) / 2, chroma = high - low;
  const scale = chroma ? Math.min(chroma * 1.3, 1 - Math.abs(2 * lightness - 1)) / chroma : 1;
  return '#' + rgb.map(channel => Math.round((lightness + (channel - lightness) * scale) * 255).toString(16).padStart(2, '0')).join('');
}

export const CLAY_COLORS = [
  ['Terracotta', '#bd7455'], ['Cream', '#ead5b5'], ['Rose', '#ce8793'],
  ['Sage', '#83a58b'], ['Ocean', '#6e9fba'], ['Lavender', '#a18db6'],
  ['Sunshine', '#e5bd50'], ['Coral', '#e87865'], ['Mint', '#83c6b2'],
  ['Plum', '#825b87'], ['Charcoal', '#45434a'], ['Pearl', '#f5eee1'],
].map(([name, hex]) => [name, intensify(hex)]);

export const DEFAULT_CLAY_COLOR = CLAY_COLORS[0][1];
