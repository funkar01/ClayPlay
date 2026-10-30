import test from 'node:test';
import assert from 'node:assert/strict';
import {MASK_SHAPES,EYE_SHAPES} from '../src/clayShapes.js';
import {ClayVolume} from '../src/clayVolume.js';

const latest=['pumpkin','vampire','witch','frankie','mummy','cat'];
test('Halloween foundations lead both lists and preserve the older options',()=>{
  assert.deepEqual(Object.keys(MASK_SHAPES).slice(0,6),latest);
  assert.deepEqual(Object.keys(EYE_SHAPES).slice(0,6),latest);
  for(const key of ['full','half','animal','armor','cowl','wings','helmet'])assert.ok(MASK_SHAPES[key]);
});

test('Each foundation starts with matching eyes and two editable, persistent pigments',()=>{
  for(const shape of latest){
    const volume=ClayVolume.fromState({shape,field:[]});
    volume.rebuildSurface=()=>{};
    volume.reset(shape);
    assert.equal(volume.eyeShape,shape);
    const pigments=new Set([...volume.paint.values()].map(value=>JSON.stringify(value)));
    assert.equal(pigments.size,2,shape);
    const restored=ClayVolume.fromState(structuredClone(volume.serialize()));
    assert.equal(restored.eyeShape,shape);
    assert.deepEqual(restored.paint,volume.paint);
    const previous=volume.snapshot();
    volume.paint.clear();
    assert.ok(previous.paint.size>0);
  }
});
