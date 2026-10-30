import test from 'node:test';
import assert from 'node:assert/strict';
import {MASK_SHAPES,EYE_SHAPES} from '../src/clayShapes.js';
import {ClayVolume} from '../src/clayVolume.js';

const latest=['pumpkin','vampire','witch','frankie','werewolf','skull'];
test('Halloween foundations lead both lists and preserve the older options',()=>{
  assert.deepEqual(Object.keys(MASK_SHAPES).slice(0,6),latest);
  assert.deepEqual(Object.keys(EYE_SHAPES).slice(0,6),latest);
  for(const key of ['full','half','animal','armor','cowl','wings','helmet'])assert.ok(MASK_SHAPES[key]);
  for(const key of ['cat','mummy']) {
    assert.ok(!Object.keys(MASK_SHAPES).includes(key));
    assert.ok(!Object.keys(EYE_SHAPES).includes(key));
    assert.ok(Object.hasOwn(MASK_SHAPES,key),'Retired saved masks remain readable');
  }
});

test('Character markings distinguish fangs, hat, wolf muzzle and skull teeth',()=>{
  assert.equal(MASK_SHAPES.vampire.accentAt(.33,-.72),false,'ivory fang');
  assert.equal(MASK_SHAPES.vampire.accentAt(0,-.72),true,'dark mouth');
  assert.equal(MASK_SHAPES.witch.accentAt(.6,1.1),true,'violet hat');
  assert.equal(MASK_SHAPES.witch.accentAt(0,1.1),false,'contrasting buckle');
  assert.equal(MASK_SHAPES.werewolf.accentAt(.35,-.55),true,'light muzzle');
  assert.equal(MASK_SHAPES.werewolf.accentAt(0,-.3),false,'dark nose');
  assert.equal(MASK_SHAPES.skull.accentAt(0,-.3),true,'nasal marking');
  assert.equal(MASK_SHAPES.skull.accentAt(.25,-.91),true,'teeth line');
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

