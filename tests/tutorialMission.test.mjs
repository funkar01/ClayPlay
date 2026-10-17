import test from 'node:test';
import assert from 'node:assert/strict';
import { missions, acceptsTutorialPull } from '../src/tutorialMission.js';
const warp = (anchor, delta) => ({ center: anchor, delta });
test('horn missions require a meaningful upward pull near the correct side', () => {
  assert.equal(acceptsTutorialPull(missions[0], warp([-.43,1.08,.4],[0,.16,0])), true);
  assert.equal(acceptsTutorialPull(missions[0], warp([.43,1.08,.4],[0,.16,0])), false);
  assert.equal(acceptsTutorialPull(missions[0], warp([-.43,1.08,.4],[0,.01,0])), false);
  assert.equal(acceptsTutorialPull(missions[0], warp([-.43,1.08,.4],[.2,-.16,0])), false);
  assert.equal(acceptsTutorialPull(missions[1], warp([.43,.8,.4],[0,.16,0])), true);
});
test('nose accepts expressive directions; non-pull steps never complete from a pull', () => {
  assert.equal(acceptsTutorialPull(missions[3], warp([0,-.08,.8],[.15,0,0])), true);
  assert.equal(acceptsTutorialPull(missions[3], warp([0,-.08,.8],[0,0,0])), false);
  assert.equal(acceptsTutorialPull(missions[2], warp([0,0,0],[1,1,1])), false);
  assert.equal(acceptsTutorialPull(missions[4], warp([.64,-.16,.5],[1,1,1])), false);
  assert.equal(acceptsTutorialPull(missions[0], null), false);
});

