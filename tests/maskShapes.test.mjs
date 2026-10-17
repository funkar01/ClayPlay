import test from 'node:test';
import assert from 'node:assert/strict';
import { MASK_SHAPES, faceSurface } from '../src/clayShapes.js';

test('Facial form has a projecting nose, forehead, cheeks and chin with wrapped temples', () => {
  assert.ok(faceSurface(0,-.08) > faceSurface(.65,-.08) + .2);
  assert.ok(faceSurface(0,.85) > faceSurface(.9,.85) + .3);
  assert.ok(faceSurface(.6,-.2) > faceSurface(.95,-.2) + .2);
  assert.ok(faceSurface(0,-1.05) > faceSurface(.6,-1.05) + .2);
});

test('Every base has a hollow, symmetric shell with finite thickness and closed rims', () => {
  for (const [name, shape] of Object.entries(MASK_SHAPES)) {
    let material = 0, rims = 0;
    for (let y = -1.7; y < 1.8; y += .1) {
      let wasInside = false;
      for (let x = -1.4; x < 1.4; x += .025) {
        const z = faceSurface(x,y);
        const d = shape.distance(x,y,z);
        assert.ok(Number.isFinite(d), name);
        assert.ok(Math.abs(d-shape.distance(-x,y,z)) < 1e-9, `${name} symmetry`);
        const inside = d < -.005;
        if (inside) {
          material++;
          assert.ok(shape.distance(x,y,z+.16) > 0, `${name} front ends`);
          assert.ok(shape.distance(x,y,z-.16) > 0, `${name} back ends`);
        }
        if (inside !== wasInside) rims++;
        wasInside = inside;
        // No part of the silhouette may remain as an infinitely thin sheet.
        if (d < -.05) {
          assert.ok(shape.distance(x,y,z+.06) < 0, `${name} front material`);
          assert.ok(shape.distance(x,y,z-.06) < 0, `${name} rear material`);
        }
      }
    }
    assert.ok(material > 100 && rims > 20, `${name} has a substantial bounded shell`);
    for (const x of [-.46,.46]) {
      const z = faceSurface(x,.35);
      for (const dz of [-.2,0,.2]) assert.ok(shape.distance(x,.35,z+dz) > 0, `${name} eye remains open`);
    }
  }
});
