# ClayPlay Mask Creation Studio

## Concept

ClayPlay Mask Studio lets people sculpt their own digital masks using hand tracking, try them on their faces, and share them with others. Players earn points through challenges and use those points to buy community-created masks for their personal wardrobe.

The central experience is: **Create → Try on → Share → Discover → Collect.**

Introduce Mask Studio as a dedicated mode within ClayPlay. Validate its appeal before making it the primary experience.

## What makes it fun

| Engagement factor | Experience |
| --- | --- |
| Personal expression | Create animals, monsters, superheroes, carnival characters, or original identities. |
| Immediate payoff | Switch to a camera mirror and wear the mask just created. |
| Playful sculpting | Pull out horns, stretch ears, smooth cheeks, stamp patterns, and paint clay. |
| Social recognition | Display creator attribution and celebrate unique wearers and favourites. |
| Fresh challenges | Offer themes such as Forest Spirit, Alien Royalty, and Funniest Monster. |
| Collection | Build a wardrobe of personal creations and masks bought from other creators. |

The strongest emotional reward is seeing another person wear something you made. Points should support that creative and social experience.

## Creation experience

### Start with a wearable foundation

Provide a small set of starter mask shells rather than requiring users to build from an empty scene. Each shell should have standard eye openings and attachment points for face try-on.

Suggested initial shells:

- Full-face mask.
- Half-face or eye mask.
- Animal-inspired mask.

Users can reshape the shell, add sculpted details, and paint its surface. Preserve essential fit regions in the first version so experimentation still produces usable masks.

### Hand controls

Keep gestures simple and give visible feedback about the active tool and editing state.

| Control | Intended behaviour |
| --- | --- |
| Move a tracked finger | Position the active brush. |
| Hold a pinch | Activate the selected tool; grab and pull when using the pull tool. |
| Release the pinch | Stop editing. |
| Select a visible tool button | Choose push, pull, smooth, or paint. |
| Use view controls | Rotate or zoom the mask without changing its shape. |

Freeze edits when tracking is lost. Use movement smoothing and a forgiving brush to reduce accidental changes. Gesture thresholds and depth behaviour need prototype testing rather than being treated as settled specifications.

### Essential assistance

- Symmetry toggle for editing both sides together.
- Adjustable brush size and strength.
- Easy undo and redo.
- Clear reset and save controls.
- Mouse or touch alternatives for fine adjustments and resting arms.
- Autosaved drafts so interrupted sessions do not lose work.

## Face try-on

Use separate creation and try-on modes initially. In try-on mode, attach a rigid mask to the tracked head with standard attachment points and scale adjustment.

Let users check the mask from the front and while turning their heads. Large horns, long ears, and unusual shapes need side-view inspection as well as a front-facing preview.

Expression-reactive deformation and simultaneous face-and-hand sculpting are later features. They introduce fitting and interaction complexity before the basic experience is proven.

Publishing a mask must not automatically publish the creator's face. Saving or sharing a camera snapshot should be an explicit action.

## Points and creator marketplace

### Earning points

| Action | Suggested reward policy |
| --- | --- |
| Complete the first mask and tutorial | One-time points reward. |
| Complete a themed challenge | Capped participation reward. |
| Receive a community award | Bonus points or a badge. |
| Sell a mask | Transfer points from the buyer to the creator. |
| Receive likes or try-ons | Recognition and statistics; avoid unlimited currency rewards. |

Do not award points simply for uploading every new mask. That would encourage repetitive, low-effort submissions. Challenge rewards should have limits, and repeated account-to-account transactions should not generate extra points.

### Buying and ownership

- Anyone can preview and try on a published mask before buying.
- Buying unlocks permanent wardrobe access to that mask.
- The creator keeps authorship and may sell the same mask to multiple players.
- Start with a few fixed price tiers rather than unrestricted pricing.
- Purchased masks should remain available if the creator stops using ClayPlay, subject to clearly stated removal rules for inappropriate content.
- Define whether remixing is allowed and preserve attribution when it is.

Treat this as an in-game points economy for the initial release. Real-money purchases or cash payouts would require a separate product review.

## Community experience

Give each published mask a title, creator name, preview, price, and clear try-on action. Support favourites, discovery by theme, and a personal wardrobe.

Use a mix of featured new creators, recent masks, and community favourites so discovery is not dominated by established accounts. Provide reporting tools for copied or inappropriate designs and establish publishing rules before opening the public gallery.

## Practical feasibility and risks

Hand and face tracking provide useful building blocks, but they do not supply clay simulation or automatic fitting of arbitrary mask geometry. Sculpting, rendering, fitting, saving, and trading still require their own implementation.

| Risk | Practical response |
| --- | --- |
| Imprecise depth control | Begin with constrained brush interaction on a visible mask surface; test depth controls early. |
| Tracking jitter or overlapping fingers | Smooth movement, show tracking feedback, and stop edits when confidence is insufficient. |
| Accidental gestures | Require an intentional held pinch to edit and make undo easy. |
| Arm fatigue | Keep sessions short and provide mouse or touch controls. |
| Poor fit across faces | Use standard attachment points, scale adjustment, and several starter shells. |
| Performance on modest devices | Limit mesh complexity and test sculpting and try-on on target devices. |
| Low-effort uploads and point farming | Cap challenge rewards and avoid rewards for raw upload counts. |
| Camera privacy | Explain camera use clearly and separate mask publishing from face-image sharing. |

These are design expectations to validate through a prototype, not measured findings about the existing ClayPlay implementation.

## Recommended first release

1. Three starter mask shells.
2. Push, pull, smooth, and paint tools.
3. Hand tracking with symmetry, adjustable brushes, and undo.
4. Mouse or touch fallback controls.
5. Rigid face try-on and optional snapshots.
6. Saved drafts and a personal mask collection.
7. A gallery with creator attribution and favourites.

After creation and try-on prove enjoyable, add themed challenges, points, fixed-price purchases, and creator sales. Expand later into stamps, accessories, remixing, and expression-reactive masks.

## Validation plan

The first usability question is: **Can a beginner make a mask they are proud to wear within five minutes?**

Observe whether users can discover the controls, intentionally change the mask, recover from mistakes, and successfully try it on without help. Test different lighting conditions, hand positions, faces, and target devices.

Track:

- Time to first successful sculpting action.
- Completion rate and time to first wearable mask.
- Tracking interruptions and accidental edits.
- Use of undo and fallback controls.
- Percentage of creators who try on and save their masks.
- Return visits, favourites, and unique community wearers.
- Once trading exists, purchase activity and whether points concentrate among a few creators.

Define quantitative launch targets after collecting an initial baseline.

## Overall recommendation

Mask Studio has strong creative and social potential because it gives clay sculpting a personal, wearable outcome. Interaction quality is the deciding factor: make sculpting forgiving and try-on satisfying, then build the points marketplace around an experience people already enjoy.

## Technical references

- [MediaPipe hand landmark documentation](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/hand_landmarker) describes the hand landmarks available for gesture interaction.
- [MediaPipe face landmark guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker?hl=en) describes face tracking outputs, including transformation matrices useful for placing face effects.

These references support tracking feasibility; they do not establish the usability or performance of the proposed studio.
