// Hollow curved mask shells facing the camera along +Z.
function maskDistance(x, y, z, kind) {
  const width = kind === 'animal' ? 1.12 : 1.04;
  const height = kind === 'half' ? 0.66 : 1.4;
  const centerY = kind === 'half' ? 0.28 : 0;
  const outline = (Math.hypot(x / width, (y - centerY) / height) - 1) * Math.min(width, height);
  const surfaceZ = 0.48 - 0.22 * (x / width) ** 2 - 0.12 * (y / 1.4) ** 2
    + 0.2 * Math.exp(-((x / 0.23) ** 2 + ((y - 0.02) / 0.42) ** 2));
  let distance = Math.max(outline, Math.abs(z - surfaceZ) - 0.105);
  if (kind === 'animal') {
    for (const side of [-1, 1]) {
      const ear = Math.max(
        (Math.hypot((x - side * 0.77) / 0.27, (y - 1.2) / 0.57) - 1) * 0.27,
        Math.abs(z - 0.21) - 0.105,
      );
      distance = Math.min(distance, ear);
    }
  }
  const eye = (Math.hypot((Math.abs(x) - 0.46) / 0.27, (y - 0.35) / 0.19) - 1) * 0.19;
  return Math.max(distance, -eye);
}

export const MASK_SHAPES = {
  full: { label: 'Full-face mask', icon: 'M5 4q7-4 14 0v8q0 7-7 10-7-3-7-10ZM7 9h3m4 0h3M10 16h4', distance: (x, y, z) => maskDistance(x, y, z, 'full') },
  half: { label: 'Half-face mask', icon: 'M3 7q9-5 18 0v5l-5 4-4-3-4 3-5-4ZM6 10h3m6 0h3', distance: (x, y, z) => maskDistance(x, y, z, 'half') },
  animal: { label: 'Animal mask', icon: 'm5 8-2-6 7 4h4l7-4-2 6v6l-7 8-7-8ZM7 11h3m4 0h3m-7 6 2 2 2-2', distance: (x, y, z) => maskDistance(x, y, z, 'animal') },
};

// Legacy volume fixture for existing sculpting regression checks only.
export const CLAY_SHAPES = {
  ...MASK_SHAPES,
  sphere: { label: 'Sphere', distance: (x, y, z) => Math.hypot(x, y, z) - 1.25 },
};
