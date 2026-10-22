import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorialRecipe, acceptsTutorialAction } from '../src/tutorialRecipes.js';
import { MASK_SHAPES, EYE_SHAPES } from '../src/clayShapes.js';

test('Recipes cover every mask and eye style without repeating the previous combination', () => {
  const recipes=Array.from({length:42},(_,i)=>createTutorialRecipe(i));
  assert.deepEqual(new Set(recipes.map(r=>r.shape)),new Set(Object.keys(MASK_SHAPES)));
  assert.deepEqual(new Set(recipes.map(r=>r.eyes)),new Set(Object.keys(EYE_SHAPES)));
  assert.equal(new Set(recipes.map(r=>`${r.shape}:${r.eyes}`)).size,42);
  for(let i=1;i<recipes.length;i++) {
    assert.notEqual(recipes[i].shape,recipes[i-1].shape);
    assert.notEqual(recipes[i].eyes,recipes[i-1].eyes);
    assert.notDeepEqual(recipes[i].steps.map(s=>s.id),recipes[i-1].steps.map(s=>s.id));
  }
  assert.deepEqual(new Set(recipes.flatMap(r=>r.steps.map(s=>s.tool))),new Set(['pinch','extrude','paint','erase']));
});

test('All recipe hints land on solid clay after applying the suggested eyes', () => {
  for(let run=0;run<42;run++) {
    const r=createTutorialRecipe(run);
    assert.equal(r.steps.length,4);
    assert.deepEqual(new Set(r.steps.map(s=>s.tool)),new Set(['pinch','extrude','paint','erase']));
    assert.equal(r.steps.at(-1).tool,'erase','erase follows the other lessons to keep their starting patches');
    for(const step of r.steps) {
      assert.ok(MASK_SHAPES[r.shape].distance(...step.target,r.eyes)<-.014,`${r.shape}/${r.eyes}/${step.id}`);
      assert.ok(step.copy.length<90,'one short instruction per challenge');
    }
  }
});

test('Recipes are deterministic across reloads and independent between runs', () => {
  const r=createTutorialRecipe(10),copy=structuredClone(r);
  r.steps[0].target[0]=99;
  assert.deepEqual(createTutorialRecipe(10),copy);
  assert.deepEqual(createTutorialRecipe(NaN),createTutorialRecipe(0));
  assert.deepEqual(createTutorialRecipe(-1),createTutorialRecipe(0));
});

test('Challenges advance only for the expected tool and a meaningful edit', () => {
  const lessons=new Map(Array.from({length:6},(_,i)=>createTutorialRecipe(i)).flatMap(r=>r.steps).map(s=>[s.id,s]));
  for(const m of lessons.values()) {
    const point=[...m.target];
    let data;
    if(m.tool==='pinch')data={center:point,delta:[.15,.15,0]};
    if(m.tool==='extrude')data={points:[point,[point[0],point[1]+.2,point[2]]]};
    if(m.tool==='paint')data={point};
    if(m.tool==='erase')data={changed:true};
    assert.equal(acceptsTutorialAction(m,m.tool,data),true,m.id);
    assert.equal(acceptsTutorialAction(m,m.tool,{}),false,m.id);
    assert.equal(acceptsTutorialAction(m,'other',data),false,m.id);
    if(m.tool==='paint')assert.equal(acceptsTutorialAction(m,'paint',{point:[9,9,9]}),false);
    if(m.tool==='extrude')assert.equal(acceptsTutorialAction(m,'extrude',{points:[point,point]}),false);
  }
});

test('Every deformation and paint guide diverges from the mask midline', async () => {
  const { outwardGuideTarget }=await import('../src/tutorialRecipes.js');
  for(let run=0;run<42;run++)for(const mission of createTutorialRecipe(run).steps) {
    const end=outwardGuideTarget(mission),start=mission.target;
    assert.ok(Math.abs(end[0])>Math.abs(start[0]),`${run}/${mission.id} must move outward`);
    assert.equal(Math.sign(end[0]),Math.sign(start[0]));
    if(mission.motion==='up')assert.ok(end[1]>start[1]);
    else assert.equal(end[1],start[1]);
    assert.equal(end[2],start[2]);
    const mirrored={...mission,target:[-start[0],start[1],start[2]]};
    const mirroredEnd=outwardGuideTarget(mirrored);
    assert.ok(Math.abs(mirroredEnd[0])>Math.abs(start[0]));
    assert.equal(mirroredEnd[0],-end[0]);
  }
});
