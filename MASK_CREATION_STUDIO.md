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
| Hold the index finger over a button for 0.5 seconds | Select a tool or menu option. |
| Close one palm on the mask | Move the mask in the screen plane. |
| Close both fists on opposite sides | Resize the mask without changing its sculpted geometry. |

Freeze edits when tracking is lost. Use movement smoothing and a forgiving brush to reduce accidental changes. Gesture thresholds and depth behaviour need prototype testing rather than being treated as settled specifications.

### Two-hand resize (local prototype)

Resizing is available automatically, with no manual toggle or status button. Place both hands on opposite sides of the selected mask, and close both fists briefly. Move apart to enlarge or together to shrink. Open either hand to keep the visible size; a lost hand also freezes the size. The range is 40–250% of the original studio size. Undo and redo include resizing, and size survives viewport changes.

Use one hand for closed-palm movement, pinch sculpting, and cuts. A second open
hand leaves one-hand editing and menus available. Closing both fists starts
Resize automatically, including when the first fist was moving the mask. After leaving two-hand mode, fully open
the remaining hand before starting a new edit, so a lost hand cannot turn
a resize into an accidental move, pinch or cut.
Both grips need to straddle the selected mask, with a comfortable gap allowed;
there is no hidden distance limit tied to the mask size. Guidance distinguishes
missing hands, same-side placement, detected grips, and an active hold.
These gestures stay separate, and resizing preserves the mask's position and edits.

Resize changes the mask's studio display scale and preserves its sculpted geometry. Try it continues to fit the mask to the detected face automatically.

Automatic switching uses one background CPU tracker configured for up to two hands throughout camera editing, with a 512-pixel capture width and at most 20 tracking updates per second, backing off when inference is slow. Changing between one- and two-hand gestures does not load models, recreate workers or reconfigure inference. Rendering interpolates between results, stopping immediately when a grip opens. Sustained inference above 120 ms for five frames pauses automatic resizing and restores one-hand tracking; restarting the camera retries automatic detection. If background tracking is unavailable, one-hand compatibility tracking remains usable. Scaling and its undo entries do not rebuild or copy the surface. Looking for a second hand has a device-dependent inference cost, even during one-hand editing; measure responsiveness on target devices.

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

### Current prototype controls

The studio currently offers **Pinch** for shaping and **Cut** for trimming.
Carve, Bulge, and the old palm-based Knife remain removed. The full-face,
half-face, and animal starters remain available.

In Cut mode, pinch to start, trace with the index fingertip, and release to finish.
Mouse users click, trace, and release. Draw from edge to edge to trim the shell,
or draw a closed loop to cut out a patch. Endpoints near an edge extend to it,
and nearly closed loops snap shut. The red
outline turns green when the loop is ready. The smaller separated piece vanishes;
incomplete strokes keep the mask unchanged and show a completion hint. Cut uses
a fixed fine width, so the brush Size and Strength sliders are disabled in this mode.
Processing happens in a background worker, retaining the old mask until the cut
is ready. The newly cut edges have thickness and support further sculpting.
A small, one-time smoothing pass softens grid steps along the cut rim without
increasing mesh resolution or adding work to live hand tracking.

Use the **V-shaped Symmetry button** to mirror new pinch drags across the selected
mask's vertical center, including Cut outlines. It starts on; when enabled, the button shows On, a dashed
center guide appears, and a second brush ring previews the opposite side.
Symmetry works with hand tracking and mouse sculpting, follows the mask when it
moves or scales, and keeps each two-sided drag as one Undo/Redo action. Centered
pulls happen once; horizontal pulls cannot cross the center while symmetry is on.
Switching symmetry affects subsequent grabs and preserves existing details.

Brush size remains adjustable from 0% to 90%; 0% turns the brush off. Strength,
colors, the mask collection, camera controls, reset, and fullscreen remain available.

The studio opens in a view that fills the browser window. **Exit full screen**
or Escape returns to the page layout. Camera setup and cursor controls remain
accessible inside the expanded studio. Reach calibration is hidden for now.

The first bottom-center message says **"Enable the AR mode for better experience!"**
with an **OK** button. Once camera setup is complete, the user can select OK by
hand. It enables AR mode and reuses the camera session. OK also works with the
cursor and starts camera setup if needed. The welcome message then gives way to
editing hints. Camera permission remains a browser-controlled setup step.

**Hand-controlled studio:** a large, fixed toolbar offers Pinch, Cut, Undo, Redo,
and More. Hold the index finger over a highlighted button for 0.5 seconds to
select it. The fingertip cursor stays visible while cutting, pulling, or moving;
blocking button selection during an edit never hides it. A ring around the cursor
fills during the countdown. Move away before
selecting again; a rebuilt menu cannot repeat a toggle or select a new button
beneath a stationary finger. Leaving the button, making a fist, or losing tracking
cancels an unfinished countdown. Either hand can control the UI; detector ordering and a second
open hand do not steal the cursor. Losing the controlling hand ends its edit
instead of transferring a held stroke to the other hand. The toolbar adapts to
a bottom row on phones.

More opens large choices for Masks, Color, Symmetry, AR, Try it, Reset position,
Reset mask, Pause editing, and camera shutdown. Mask cards and starter buttons,
color swatches, custom color mixing, Back, Close, and scrolling are selectable by
hand. Reset, removal, and camera shutdown require confirmation. Pause editing
keeps the camera running so Resume remains selectable by hand. Camera shutdown
explains that restarting will need cursor input.

Menus reserve input and pause mask editing. A sculpt, cut, move, or resize that
has already begun keeps ownership until release; crossing a button cannot select
it. A second deliberate fist can transition a move into a resize. UI selection
must finish and the hand open before editing resumes. Two hands
make resizing available; both deliberate closed grips start it. Merely showing a
second hand leaves one-hand editing and menus available. Native camera input maps
the index and mask interaction to the same screen positions, including AR cover
cropping, while the retained trace-replay hook supports older local recordings.

**Create with the cursor:** when the camera is off, Pinch and Cut are ready
automatically, including after a camera permission failure or disconnection.
With Pinch selected, click a solid mask patch and drag; releasing keeps the
visible shape immediately. With Cut selected, hold the mouse button and trace
edge to edge or a closed loop, then release to remove the smaller piece.
Symmetry and Undo/Redo work the same way as hand input. Pointer capture keeps
drags continuous, and cancelled pointers or focus loss safely end a pull or
discard an unfinished cut. No virtual hand or tracking model is needed for
cursor editing. Camera controls remain accessible; starting the camera switches
editing back to hand tracking, and Try it pauses editing while wearing the mask.

**Move the mask:** close your palm over a solid part of the selected mask, then
move your hand across the screen. Open your palm to leave the mask at that position
and continue pinching or cutting. This works in the studio and AR view without a
separate tool switch. Opening the palm or losing tracking immediately stops movement;
a whole-hand closure takes priority even when the thumb and index touch. Movement
stays reserved while closing or opening the palm, including uncertain tracking
frames. Fully open the hand, then pinch with the other fingers open to resume
sculpting; normal pinch confirmation remains fast.

**Reset position** returns the selected mask to its starting place, preserving its
shape, color, and size. Movement and position resets support Undo/Redo, and each
mask keeps its offset when the view changes. Moving only changes the mask's scene
position; it reuses one-hand tracking and does not remesh or copy the geometry.
Resize retains its existing two-hand gesture, and Try it temporarily fits the mask
to the face before returning to the studio position.

Choose **More → AR mode** to show the live camera behind the mask.
It reuses the camera stream, requesting camera access if it is not already on.
The background is mirrored like the camera preview. Pinch, Cut, symmetry, color,
and Undo/Redo remain available while you work over the camera view. The virtual
hand is hidden so the real hand stays visible. Fingertip targeting follows the
video's cropping and the play area's size, including fullscreen. Turning AR off
returns to the studio background and keeps the mask and camera session; stopping
the camera turns AR off as well. Camera video stays on the device.

Choose **More → Try it** to wear the selected mask in the camera view.
The mask automatically aligns its eye openings with your eyes and follows head
movement, tilt, and turns. It uses your actual cuts, sculpting, and color; switch
masks or colors through More while wearing it. Sculpting is paused until
you turn Try it off, which restores your previous view and keeps every edit and
Undo/Redo action. **Back to creating** is a large hand-selectable button. If your
face leaves the frame, the mask hides until you return.
Stopping the camera or AR mode also ends try-on.

Face tracking loads only when requested, reuses the camera stream, and processes
one face locally with [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
Background tracking and shared mask geometry keep preview work small. Try it
shares a sequential schedule between face and hand inference: it probes for hands
at a low rate, then gives UI selection more updates while a hand is present and
reduces face updates temporarily. It reuses the hand tracker and never schedules
face and hand inference concurrently in this mode. Cadence adapts to inference
time; target-device performance and gesture comfort still need user testing. The
first use downloads the face model.

### Proposed later scope

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
