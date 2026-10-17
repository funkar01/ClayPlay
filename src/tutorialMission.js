export const missions = [
  { id: 'horn-left', tool: 'pinch', target: [-.43, 1.08, .4], title: 'Give your mask two little horns.', copy: 'Pinch the glowing spot, pull up, then open your fingers.' },
  { id: 'horn-right', tool: 'pinch', target: [.43, 1.08, .4], title: 'One more—your way.', copy: 'Pinch the other spot, pull up, then open your fingers.' },
  { id: 'win', title: 'Your horns are ready!', copy: 'Try it on or add more personality.' },
  { id: 'nose', tool: 'pinch', target: [0, -.08, .85], title: 'Give it a cheeky nose.', copy: 'Pinch the middle, pull sideways, then open your fingers.' },
  { id: 'cheeks', tool: 'paint', target: [.64, -.16, .5], title: 'Add a little colour.', copy: 'Pinch the cheek, brush a curve, then open your fingers.' },
  { id: 'done', title: 'Meet your new character.', copy: 'Try it on or keep creating.' },
];

// Require a committed, meaningful stroke near the mission, never just a pinch.
export function acceptsTutorialPull(mission, warp) {
  if (!mission?.target || mission.tool !== 'pinch' || !warp?.center || !warp?.delta) return false;
  const [x, y] = mission.target;
  if (Math.hypot(warp.center[0] - x, warp.center[1] - y) > .42) return false;
  return mission.id.startsWith('horn') ? warp.delta[1] > .09 : Math.hypot(...warp.delta) > .09;
}

