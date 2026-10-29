import { acceptsTutorialAction } from './tutorialRecipes.js';

// Tutorial pacing waits for the entire visible revision, even when free play
// would already allow another stroke to be queued in the background.
export function tutorialApplying(volume) {
  const paint=volume.material?.userData.surfacePaint;
  return Boolean(volume.pulling || volume.cutting || volume.erasing
    || volume.meshQueue?.pending || volume.meshQueue?.refining
    || volume.surfaceExtrude?.committing || volume.surfaceExtrude?.queue?.length
    || paint?.dirty || paint?.completed || paint?.queue?.active || paint?.queue?.pending);
}

export class TutorialStepGate {
  constructor(){this.reset();}
  reset(){this.pending=false;this.readyFrames=0;}
  record(mission,tool,data) {
    if(this.pending || !acceptsTutorialAction(mission,tool,data))return false;
    this.pending=true;this.readyFrames=0;return true;
  }
  update({busy,held}) {
    if(!this.pending)return false;
    if(busy || held){this.readyFrames=0;return false;}
    // Leave one complete render turn for the final geometry/paint to appear
    // before changing the tool, instruction, and highlighted target.
    if(++this.readyFrames<2)return false;
    this.reset();return true;
  }
}
