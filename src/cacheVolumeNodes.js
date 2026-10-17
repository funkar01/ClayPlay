// Cache grid samples throughout the immutable deformation chain. A sample of
// a pulled field otherwise recursively evaluates eight source nodes per layer.
// Live overlay edits always override the cached underlying field.
export function cacheVolumeNodes(volume, seen = new WeakSet()) {
  if (!volume || seen.has(volume)) return volume;
  seen.add(volume);
  for (const source of [volume.pullSource, volume.cutSource, volume.extrudeSource]) cacheVolumeNodes(source, seen);
  const sample = volume.nodeValue.bind(volume), nodes = new Map();
  volume.nodeValue = (x, y, z) => {
    const key = volume.nodeKey(x, y, z), edit = volume.field.get(key);
    if (edit !== undefined) return edit;
    if (nodes.has(key)) return nodes.get(key);
    const value = sample(x, y, z); nodes.set(key, value); return value;
  };
  return volume;
}
