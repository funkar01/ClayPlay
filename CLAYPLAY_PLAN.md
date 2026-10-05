# ClayPlay — Living Project Notes

This file captures the decisions, plans, and feedback from our ClayPlay project discussions. We’ll keep it updated as the project evolves.

## Project idea

ClayPlay is a webcam-based creative experience for sculpting and modelling virtual clay with hand gestures. The goal is a playful, approachable experience that people can try without special hardware.

## Creative direction

- Prioritize a satisfying, understandable sculpting feel over feature count.
- Make each development milestone playable and reviewable.
- Keep gesture detection separate from clay deformation so input methods can evolve.
- Design for varied lighting, camera placement, and hand movement.
- Provide visible feedback, calibration guidance, and a mouse fallback.
- Build the core interaction before adding AI generation, voice, or sharing features.

## Implementation plan

### Milestone 0 — Agree on the first experience

**Goal:** Decide what a first-time player should be able to do in a short session.

Sub goals:
- Pick one starter object: a ball of clay.
- Pick one core action: pinch and pull the clay.
- Choose a simple visual direction: warm, tactile, playful.
- Decide how the experience begins: a short camera setup, then “try pinching the clay.”

**Playable result:** A clear product target and a small interaction to build toward.

**Done when:** We can describe the first minute of play in a few sentences.

**Decision — first minute of play**

ClayPlay opens on a quiet, warm-colored studio with one soft terracotta ball centered on a simple work surface. A short setup card explains that the webcam is used to track a hand; the player can start the camera, see a live preview, and adjust their position until a hand is visible. Once tracking is ready, the preview gets out of the way and the prompt changes to **“Pinch the clay, then pull.”** The player brings thumb and index finger together and moves their hand to make one small lump or tail in the ball. A clear visual cue shows when the pinch is active, and releasing the fingers stops the clay. A reset action restores the original ball; a mouse drag remains available if camera access or tracking is unavailable.

**Experience guardrails**

- Keep the first screen focused on one clay ball and one action; no tool palette or account flow.
- Ask for camera access only after the player chooses to begin camera setup, and explain why it is needed.
- Show a concise positioning/light hint if no hand is detected, with a way to continue using the mouse.
- Use warm, matte clay, soft shadows, and friendly, plain-language prompts. Keep the clay and interaction cue easy to read.
- Treat the pinch cue as feedback, not the only indication of success: the clay visibly follows the hand while pinched.

**First-minute checkpoints**

1. **0–10 seconds:** See the clay ball and understand that hands can shape it.
2. **10–25 seconds:** Choose camera setup, grant access, and get a simple “hand ready” confirmation.
3. **25–40 seconds:** See “Pinch the clay, then pull” and a visual hint for thumb and index finger.
4. **40–60 seconds:** Pinch, move, and release; see the clay deform and settle, with reset available.

This is the product target for Milestone 1 and the first interaction prototype. Exact timing is a design target, not a requirement to block a player who needs more setup time.

### Milestone 1 — A reliable webcam hand skeleton

**Goal:** See your hand tracked on screen with enough stability to build on.

Sub goals:
- Set up the Vite app and basic Three.js scene.
- Request webcam access and show a camera preview.
- Add MediaPipe hand tracking and draw its landmarks.
- Smooth the landmarks and show when a hand is detected.
- Add a short camera and lighting hint if tracking is unreliable.

**Playable result:** Move your hand in front of the camera and see a stable skeleton follow it.

**Done when:** Tracking works in ordinary indoor light and the app clearly tells you when it loses your hand.

**Implementation status — prototype ready for a webcam try**

- Added a Vite app with a warm studio screen and a Three.js view for the hand skeleton.
- Added opt-in camera setup, a mirrored preview, and MediaPipe Hand Landmarker tracking for one hand.
- Draws 21 landmarks and their connections in both the preview and the 3D scene, with exponential smoothing to reduce jitter.
- Shows hand-ready, searching, and lost-hand guidance, plus camera and lighting tips.
- Added a mouse-driven hand preview so the visual tracking scene can be explored without camera access. It previews motion only; webcam recognition still needs to be checked on a real camera.
- Aligned the pinned MediaPipe JavaScript package and hosted WASM runtime at version `0.10.35`. Previously the app loaded package `0.10.35` with WASM `0.10.22`, so tracking setup could fail after camera permission succeeded.
- Separated camera-access failures from hand-tracker setup failures. If tracking files fail to load, the camera preview stays on and the player can retry tracking or switch to mouse preview.
- Confirmed in-browser that the webcam starts and MediaPipe detects one hand in indoor lighting. Loss and reacquisition still need a deliberate check before Milestone 1 is complete.

### Milestone 2 — First clay interaction

**Goal:** Make the clay respond to one clear hand action.

Sub goals:
- Add a clay sphere with a soft, appealing material.
- Load the rigged VR hand mesh and map its wrist and finger joints to the tracked landmarks.
- Detect a pinch with separate start and release thresholds to prevent flicker.
- Deform a soft strip along the finger paths while pinching and moving.
- Show a visible cue when the pinch is active.
- Add a reset button in case the clay gets misshapen.

**Playable result:** Pinch and pull the sphere to make a lump or tail.

**Done when:** A first-time player can make the clay move within a minute, and release stops the pull reliably.

**Implementation status — first interaction prototype ready for a try**

- Added a soft terracotta icosphere to the studio and kept it visible before camera setup.
- Added thumb-to-index pinch detection normalized by palm width, with separate pinch and release thresholds to reduce flicker.
- Maps the finger paths onto the visible front of the clay and pulls a local strip with a smooth falloff while the pinch moves.
- Added an active pinch cue, first-use shaping prompts, and a reset control.
- Replaced the procedural palm patch and finger segments with `assets/vr_hands_rigged.glb`.
- Split the combined skinned mesh into left and right surfaces by skin weights, then select the matching hand using MediaPipe handedness.
- Retargeted the wrist, palm, and four joints on each finger to the 21 MediaPipe landmarks; mouse mode uses the same rig with a right-hand pose.
- Pinching now lets the tracked finger paths shape a soft strip of clay along their movement; mouse click-and-drag uses the same path model.
- Rebound the skinned mesh after setting its scene scale so the GLB rest pose and live joint targets share the same coordinate space.
- Confirmed the production bundle builds and the replacement mesh appears in mouse mode and a live hand-tracking session. Alignment, handedness, perceived proportions, and pinch feel still need hands-on feedback before this milestone is complete.

**Feedback to collect on the first try**

1. Does the 3D hand read as a hand shaping clay, and does it line up with your live hand?
2. Is it clear where to put your hand and when the pinch is active?
3. Does the clay change along the finger paths, or does it still feel like a single-point tool?
4. Does the pull feel too weak, too strong, too lumpy, or too slow?
5. Does releasing reliably stop the deformation, and does reset behave as expected?

**Design direction — rigged hand mesh and landmark-driven contact**

Use the rigged VR hand as the visible hand surface, retargeted from MediaPipe’s wrist and finger landmarks. During an intentional pinch, use the tracked finger paths as soft deformation strokes so the clay follows the curves of the fingers. Tune the model’s scale, orientation, and contact depth from webcam trials and keep the response forgiving.

### Milestone 3 — Make the sculpting feel good

**Goal:** Improve the core interaction before adding more tools.

Sub goals:
- Tune how far and how quickly the clay moves.
- Add a brush-size control.
- Test different hand positions, distances, and lighting.
- Add mouse interaction as a fallback.
- Add an undo action for recent changes.
- Keep deformation responsive as the mesh changes.

**Playable result:** A repeatable sculpting loop that works even when webcam conditions aren’t perfect.

**Done when:** We can identify and tune the main causes of “that didn’t do what I expected.”

### Milestone 4 — Add a small, learnable toolset

**Goal:** Let players shape rather than only stretch.

Sub goals:
- Keep pinch-to-pull as the primary tool.
- Add one smoothing action.
- Add one carving action if it is easy to distinguish and learn.
- Show the current tool clearly.
- Include a short gesture guide that can be reopened.

**Playable result:** Players can shape a simple object with a small set of understandable tools.

**Done when:** Someone can learn the gestures without remembering a long list of poses.

### Milestone 5 — Make it feel like clay

**Goal:** Give the interaction a tactile, satisfying presentation.

Sub goals:
- Tune the clay color, roughness, lighting, and shadows.
- Add subtle surface detail.
- Add gentle audio feedback with a mute option.
- Try a slow turntable mode for inspecting the sculpture.
- Make the canvas and controls work at common desktop sizes.

**Playable result:** A sculpting session that looks and feels cohesive.

**Done when:** The clay is easy to read on screen and the presentation makes people want to keep playing.

### Milestone 6 — Save and share a sculpture

**Goal:** Let players keep something they made.

Sub goals:
- Save and reload a sculpture locally.
- Export the model as GLB.
- Add a simple gallery or share flow if the export experience is solid.
- Explain what is saved and give clear success or error feedback.

**Playable result:** A player can sculpt, leave, and return to their creation.

**Done when:** We can create and reopen a sculpture without losing the work.

### Milestone 7 — Optional AI starter shapes

**Goal:** Let players begin with more than a sphere.

Sub goals:
- Add a few built-in starter shapes first.
- Add text-to-3D generation as an optional path.
- Let players preview a result before sculpting it.
- Handle loading, failures, and service limits gracefully.
- Check the chosen service’s export and usage terms before release.

**Playable result:** Players can choose a starter shape or request one, then sculpt it.

**Done when:** The AI feature adds delight without blocking the basic sculpting experience.

### Milestone 8 — Share a polished demo

**Goal:** Make ClayPlay easy to try and easy to show.

Sub goals:
- Add a short, friendly first-run guide.
- Record a 30-second demo showing the interaction clearly.
- Test the experience on different webcams and in different lighting.
- Deploy the web app.
- Write a short project story about the process and what you learned.

**Playable result:** A public demo that someone can open and understand quickly.

**Done when:** A new visitor can get from opening the page to shaping clay without needing us beside them.

## Iteration rhythm

For each milestone:

1. Build one small change that supports the current goal.
2. Try it in the browser under realistic conditions.
3. Share specific feedback: what felt fun, confusing, slow, or unreliable.
4. Choose one or two adjustments based on that feedback.
5. Repeat until the milestone’s completion criteria are met.

We’ll keep a short running list of observations and decisions so feedback turns into concrete next steps rather than a growing wishlist.

## Current next target

Try the rigged hand in mouse mode, then set up the camera and bring your tracked fingertips over the clay before pinching and tracing a small curve. Share whether the mesh follows your palm and finger curves, whether handedness and orientation look right, and what feels weak, strong, confusing, or unreliable. Milestone 1’s hand detection still needs confirmation in ordinary indoor light as part of the webcam try.

## Discussion log

### 2026-10-02 — Initial implementation plan

- Agreed on a milestone-based, playable development plan.
- Prioritized a reliable hand skeleton, then pinch-to-pull as the first clay interaction.
- Identified tracking stability and predictable interaction as the main early risks.
- Deferred advanced gestures, AI generation, voice commands, and gallery features until the core loop feels good.
- Established an iterative feedback loop: build, try, report, adjust, repeat.

### 2026-10-02 — Milestone 0: first experience

- Chose the ball of clay as the sole starter object and pinch-and-pull as the first action.
- Defined the first-minute flow: explain and start camera setup, confirm hand readiness, prompt a pinch-and-pull, then make release and reset clear.
- Set the visual direction to a warm, minimal studio with matte terracotta clay, soft light, and a readable active-pinch cue.
- Kept mouse sculpting as an accessible fallback when camera setup or tracking is unavailable.
- Marked Milestone 0 complete; Milestone 1 is the next build target.

### 2026-10-02 — Milestone 1: tracking prototype

- Set up the Vite app, Three.js studio scene, and responsive camera setup screen.
- Added a mirrored webcam preview and one-hand MediaPipe landmark tracking, with a GPU-to-CPU initialization fallback.
- Smoothed hand landmarks and drew the connected skeleton in the preview and 3D scene.
- Added hand-search/lost guidance, camera and light hints, and a mouse-driven skeleton preview.
- Fixed the package/runtime version mismatch and kept camera errors distinct from tracker loading errors.
- Built the production bundle and confirmed that webcam startup now reaches the hand-search state. Landmark detection and reacquisition still need a framed hand and ordinary-light check before Milestone 1 can be marked done.

### 2026-10-02 — Milestone 2: first clay interaction

- Added the clay sphere, pinch-and-pull deformation, soft local falloff, active pinch cue, and reset control.
- Added pinch hysteresis using a normalized distance between thumb and index, relative to palm width.
- Connected mouse click-and-drag to the same sculpting path for camera-free iteration.
- Confirmed a mouse drag deforms the clay and exposes reset; merged geometry vertices to keep shading smooth after a pull.
- Prototyped a palm patch and articulated finger surface from the hand landmarks; pinch movement now deforms clay along the finger paths.
- Corrected the hand-ready tip so it no longer says “Bring your hand back” while a hand is detected.
- Production build succeeds. The next step is hands-on feedback on hand alignment, curve contact, pinch reliability, and deformation feel; webcam behavior has not yet been confirmed in a real session.

### 2026-10-02 — Landmark-driven hand surface idea

- Based on the webcam view, proposed replacing the detached landmark skeleton with a visible palm-and-finger surface that reads as a hand shaping clay.
- Chose to use finger paths as the deformation brush during pinch so the clay responds along the curves of the fingers.
- Recorded the technical limit: the tracker supplies landmark points, so the hand surface is inferred and needs calibration from real webcam use.

### 2026-10-02 — XYZ orientation gizmo

- Added a compact, labeled X-Y-Z orientation marker in the studio’s upper-left corner, below the stage caption.
- Matched axis colors to the warm interface and kept the marker decorative so it does not intercept sculpting input.

### 2026-10-02 — Flip the modeled hand along Z

- Interpreted the request as reversing depth for the 3D hand and fingers while preserving screen-space X/Y mapping and the mirrored webcam preview.
- Inverted the Z mapping used by the rendered hand surface. Clay contact and deformation remain mapped from the same X/Y finger paths.
- The visible depth orientation needs confirmation in a live webcam session.

### 2026-10-02 — Rigged hand asset format

- Recommended binary glTF 2.0 (`.glb`) for a replacement hand model in the Three.js web app.
- Asset should contain a skinned mesh and an articulated hand skeleton with wrist/palm and finger joints; animation clips are optional because webcam landmarks will drive the joints live.
- Plan for an explicit mapping between the asset’s bone names and MediaPipe’s 21 hand landmarks. Confirm rest pose, handedness, scale, and axis orientation when selecting the model.

### 2026-10-02 — Replace the procedural hand with the VR rig

- Loaded `assets/vr_hands_rigged.glb` and replaced the generated palm patch, finger cylinders, and joint spheres.
- Split the asset’s combined left/right skinned surface by joint skin weights and choose the mesh side from MediaPipe handedness.
- Mapped the wrist and palm plus four joints on each finger to the 21 landmarks; kept pinch detection and clay deformation separate from hand rendering.
- Rebuilt the bind pose after applying the scene scale and kept the mirrored camera preview and existing Z-depth mapping.
- Production build succeeds and mouse mode shows the replacement mesh. Its scale, orientation, and webcam alignment remain open for hands-on feedback.
- Confirmed the current webcam session detects one hand and renders the new mesh over the clay; the mesh’s fit to the real hand and pinch interaction still need user feedback.

### 2026-10-02 — Restore VR hand proportions and landmark mapping

- Fixed the deformed, spike-like hand: the earlier mapping translated every rig joint onto its landmark, changing the GLB’s segment lengths and pulling its skin apart.
- Keep the asset’s bind/rest structure intact. Fit and orient the complete hand from wrist and palm landmarks, scale from palm width, and rotate the finger bones along the tracked landmark segments.
- Continue selecting the matching left/right hand mesh from MediaPipe handedness; keep pinch and clay deformation on their existing path.
- Production build succeeds. Next live check: confirm the hand surface follows the detected palm and finger bends, and that its pinch reaches the clay naturally.

### 2026-10-02 — Reverse hand movement on Z

- Reversed the MediaPipe depth-to-scene mapping for the rigged hand. Moving a hand toward the webcam now moves the virtual hand toward the viewer; moving it away moves it back.
- Screen-space X/Y, pinch detection, and clay deformation remain unchanged.
- Production build succeeds. Confirm the direction with a short toward/away webcam motion.

### 2026-10-02 — Near/far hand scale behavior

- Preserve apparent camera-space size: tracked image-space landmarks make a nearby hand render larger and a distant hand smaller; finger and palm thickness follow the tracked palm width.
- MediaPipe hand-landmark Z is wrist-relative, so it is not used as a global distance-based scale multiplier. This keeps the displayed hand aligned with the tracked fingertips and clay contact.

### 2026-10-02 — Smooth, rounded clay pulls

- User feedback: pulled clay should form a soft, continuous, tapered tail that blends into the blob, rather than a sharp or faceted point.
- Follow-up clarified that smoothing should affect the whole pulled surface without increasing the tail radius.
- Found two causes of the sharp cut: the deformation skipped back-facing vertices, and dividing by accumulated falloff canceled the taper near the brush boundary. The prior constant outward Z displacement also puffed up the tail.
- Fixed deformation to use full 3D brush distance, preserve a smooth falloff in the displacement, remove the artificial outward bulge, and reduce the brush radius slightly. Added a light local vertex-relaxation pass and recompute normals after each pull update.
- Next live check: compare webcam and mouse pulls for a rounded continuous surface, a narrow tail, and acceptable response speed. Tune smoothing strength from feedback.

### 2026-10-02 — Add a Carve tool

- Added a Pinch/Carve tool switch in the studio. Pinch remains the pull-and-stretch tool.
- In Carve mode, trace with the index fingertip to press a narrow, rounded groove into the clay along the path. Mouse preview uses click-and-drag for the same stroke; webcam mode carves while the fingertip moves across the surface.
- Carving follows the clay surface with a camera ray, applies a tapered inward displacement along the traced curve, and lightly relaxes the affected mesh. Reset restores the original clay.
- Production build succeeds. Next check: try tight and broad curves with webcam and mouse input; tune groove depth, radius, and response from feedback.

### 2026-10-03 — Core clay simulation principle: dynamic topology

- User clarified the foundational requirement: clay is a continuous, malleable material. Pinch, pull, carve, and bulge must produce locally smooth, rounded deformations that follow the hand path.
- A fixed-resolution mesh with vertex displacement and smoothing alone is not the target. Add or redistribute vertices/polygons where deformation creates detail, so tight curves and narrow tails remain smooth instead of forming sharp or faceted edges.
- Preserve cohesive clay behavior across the whole surface, including smooth transitions and convincing volume response; deformation topology must adapt to the manipulation rather than forcing the shape into the starting mesh resolution.
- Treat adaptive remeshing/dynamic topology as a core architecture requirement for the sculpting engine, and validate it against reference pulls and carved curves before adding more tools.

### 2026-10-03 — Technical flow for continuous clay

- Recommended canonical shape representation: a signed-distance field (SDF), stored in sparse fixed-pitch voxel bricks. The field, not the display mesh, is the source of truth. Extract a new triangle surface from affected bricks after each stroke segment; this allows topology and vertex count to change with the deformation.
- Begin with equal voxel pitch in neighboring bricks to avoid adaptive-resolution seams. Allocate/update only bricks intersecting the brush bounds plus a one-cell halo; refine resolution or introduce an octree only after the first smooth version is playable.
- Resample webcam/mouse strokes along the 3D finger path at intervals no larger than half a voxel. Apply operation-specific field edits: inverse-warp/advect the field for pinch-pull, smooth subtraction of a stroke capsule for carve, and a local smooth/filter pass plus distance reinitialization for smoothing.
- After an edit, remesh affected bricks, stitch their shared boundary cells, update normals and bounds, then swap the resulting geometry into Three.js and dispose the old geometry. The Three.js MarchingCubes addon is suitable for a quick field/mesh prototype; production local remeshing should own chunking, affected-region updates, and seam handling.
- Keep hand tracking and gesture recognition independent from clay operations. Each tool emits a sampled stroke with position, radius, direction, and pressure/strength; the SDF sculpt engine applies it and can later support undo via stroke replay or sparse field snapshots.
- Milestone order: (1) SDF sphere + smooth carved curve in mouse mode, (2) local remesh and verify topology increases around the stroke, (3) pinch-pull via a smooth deformation warp, (4) webcam stroke input and volume/shape tuning, (5) worker/off-main-thread performance and undo.
- Acceptance checks: no cut/faceted edges; narrow carve width remains controlled; pulled tails blend continuously; surface stays watertight; detail increases where strokes need it; mouse and webcam produce comparable results; maintain a playable frame rate on the target PC.

### 2026-10-03 — SDF volume-backed sculpting baseline implemented

- Replaced the fixed icosphere vertex deformation with a signed-distance field as the source of truth. The field uses a 0.025-unit voxel pitch over sparse 24-cell bricks; untouched samples evaluate against the initial sphere instead of occupying a dense volume array.
- Added marching-tetrahedra surface extraction with interpolated SDF-gradient normals. Startup creates only surface bricks; Pull and Carve regenerate the bricks touched by each stroke, disposing/replacing their previous buffer geometry.
- Pinch now applies a smooth local inverse warp to the volume along the tracked pinch point. Carve subtracts a rounded capsule from the field along the index-finger path. Reset clears field edits and rebuilds the starting clay.
- Kept Pinch/Carve selection and mouse preview. A mouse pull and an index-finger carve stroke both reached the remeshing path in the running studio; production build succeeds.
- Known next refinement: the brick grid currently uses a consistent voxel pitch for crack-free boundaries; variable-resolution local refinement, undoable stroke replay, worker-based remeshing, and broader live-webcam feedback remain follow-up work.

### 2026-10-03 — Tool strength and brush size controls

- Agreed that deformation strength should be adjustable per sculpting tool so users can tune subtle versus dramatic edits.
- Keep **Strength** separate from **Brush size**. Strength controls how much the clay changes; brush size controls the affected footprint. For Pinch, strength scales pull sensitivity/displacement. For Carve, strength controls groove depth while brush size controls groove width. For Bulge, strength controls outward displacement while brush size controls its footprint.
- Give each tool a useful default that preserves the current feel, and expose a shared 0–100 Strength slider whose meaning is mapped by the active tool. Add a separate Size control when the tool is selected; avoid changing carve width when users only want a deeper cut.
- Pinch already caps per-update movement, so a strength implementation must scale the effective displacement range as well as the input gain; otherwise high settings may hit the same cap and feel identical. Keep the maximum bounded to avoid abrupt snapping.
- Before increasing strength to compensate for weak response, validate actual clay contact. The current screenshot shows the pinch cue near the clay edge; the existing coarse inside-clay cue and surface-ray hit are separate checks, so missed contact may be making pulls appear weak. Show clear contact feedback and start deformation only after a real surface hit.
- Suggested iteration: verify fingertip-to-surface contact first, compare low/default/high Pinch strength, then tune Carve depth independently from width. Add Bulge after the shared strength/size behavior feels consistent. Use the same controls in webcam and mouse preview modes.

### 2026-10-03 — Strength control implemented and checked

- Added a shared 0–100 Strength slider below the tool selector, starting at 55. The value carries across tool changes, updates immediately, and supports keyboard control. Zero makes no edit. Tool-specific captions explain Pull distance, Cut depth, and Raised amount.
- Pinch scales movement gain and the allowed displacement together. It requires an actual surface hit to start, then keeps the grab attached on a stable drag plane beyond the original silhouette. Small deformation steps carry the clay to the new position before remeshing; a volume-boundary margin prevents clipping the tail at the field edge.
- Carve uses a rounded elliptical cutter: Strength changes its inward depth, with the lateral brush radius kept at 0.105. Fixed the cutter endcaps so a short stroke cannot cut an unbounded flat strip.
- Added Bulge as a third tool. It uses smooth union with a rounded stroke volume; Strength sets its height and its brush radius stays at 0.28. Carve and Bulge reference the surface at stroke start so previous edits within the same stroke do not cause runaway depth or height feedback. A brush-size slider remains a separate future control.
- Cleared held strokes on pointer cancellation, tool change, reset, and tracking loss. Reset restores the active tool's ready message.
- Verification: production build passes with the existing bundle-size warning. Four automated checks cover zero strength, increasing carve depth with bounded width/endcaps, increasing bulge height, and farther pulls from the same input motion. All pass; generated geometry positions and normals remain finite.
- Measured carve depths for low/default/high were 0.025/0.135/0.225 scene units. Bulge heights were approximately 0.009/0.139/0.240. The same two input movements produced pull extents of 1.311/1.520/1.815 along X at strength 10/55/100.
- Browser mouse preview: exercised all three tools at maximum strength, checked slider updates and tool captions, confirmed a zero-strength stroke leaves Reset hidden, and observed no browser console errors. Preview image saved in `artifacts/strength-preview.jpg`.
- Next user feedback: compare Strength 25, 55, and 85 with the same hand motion, resetting between comparisons. Live webcam feel and sustained sculpting performance still need hands-on feedback; this remains an approximate volume sculptor rather than a full clay physics simulation.

### 2026-10-03 — Larger play area and fullscreen

- User annotation: make the 3D sculpting surface larger because it is the main play area, and provide a fullscreen option.
- Expanded the workspace maximum width from 1280 to 1720 pixels, reduced the sidebar gap, and increased the desktop stage height to 62% of the viewport (440–740 pixels). Tablets place the sidebar below the studio; narrow screens get a taller stage and separate space for the bottom hint and fullscreen control.
- Added a Full screen button inside the stage. Native fullscreen includes the clay, hand view, axes, tool selector, Strength, Reset, and guidance. Exit full screen or Escape returns to the studio. Browsers that cannot enter native fullscreen expand the stage within the tab instead.
- Keep the same renderer, clay, and camera session across view changes. The existing resize observer updates the canvas and perspective. Cancel the current stroke when changing view size to avoid a jump caused by a changed aspect ratio; preserve the selected tool and Strength. Background controls are inert while expanded, and focus returns to the fullscreen button on exit.
- Verification: production build passes with the existing bundle-size warning. Browser checks confirmed native entry, Escape exit, button exit, repeat entry, matching fullscreen canvas/stage dimensions (1936 × 1096), preserved Carve/Strength settings, restored background focus access, and no console errors. Saved `artifacts/fullscreen-preview.jpg`.
- Responsive styles are implemented, but the embedded browser's viewport override did not change the test tab size, so narrow-screen rendering and the unsupported-fullscreen fallback still need a device/browser check. Live hand feel in fullscreen remains open for user feedback.

### 2026-10-03 — Opening ClayPlay correctly

- User reported an unstyled page with oversized axis artwork. The screenshot showed the source `index.html` opened directly from the I: drive using the file protocol. The Vite entry module and its CSS imports require the local server; opening the HTML file directly does not start the application.
- The local server was also stopped. Restarted it at `http://127.0.0.1:5173/`. Open this URL in Chrome to use ClayPlay.
- For future sessions, run `npm run dev -- --host 127.0.0.1` from `I:\AntiGravities\ClayPlay` and keep that terminal running while using the app.

### 2026-10-03 — Multiple clay shapes and individual colors

- User requested rounded cubes, rounded prisms, other basic shapes, an add menu, and color controls. Clarified that adding a shape should create a separate object, with a choice of which object to sculpt.
- Added Sphere, Rounded cube, Rounded triangular prism, softly rounded Cylinder, Capsule, and Ring. Each uses its own signed-distance field and remeshed surface, so all three existing sculpt tools operate on the selected piece.
- Added the **Shapes & color** menu inside the play area, including fullscreen. Shape buttons add a new piece without replacing existing work. A selected-object list and clicking a piece choose the active object; a small ring and name identify the selection.
- Each piece has an independent material, six color swatches, and a custom color picker. New pieces start in the selected color. Reset restores only the selected object's starting shape and keeps its color. Remove selected removes that piece; at least one piece remains.
- Automatically arrange and scale the pieces to fit the canvas on addition, removal, or resize. Limit the scene to eight pieces for this version. Moving, rotating, merging objects, and saving scenes remain separate future features.
- Pause sculpting while the menu is open and clear the current stroke on selection/layout changes. Align mouse sculpting with the actual cursor so clicks and strokes target the same piece.
- Production build passes with the existing bundle-size warning. No new automated tests were added.
- Browser walkthrough: added all six shapes to one scene, assigned distinct palette colors, selected pieces by canvas click and dropdown, and used the menu in fullscreen. Carved the rounded cube, switched to the untouched sphere (Reset hidden), returned to the edited cube (Reset visible), and reset it while preserving its green color and all six pieces. No browser console errors were reported. Saved `artifacts/shapes-colors-preview.jpg`.
- Creating or resetting a dense shape can briefly pause the interface while its surface is generated. The menu shows an adding message; moving mesh generation to a worker remains a performance follow-up. Live webcam sculpting across multiple pieces still needs user feedback.

### 2026-10-03 — Design discussion: user-view hand depth and apparent size

- User illustrated the remaining viewpoint mismatch: hand near the body (farther from the webcam) renders smaller; reaching toward the screen (closer to the webcam) renders larger. Desired behavior is the user's viewpoint: near the user = larger/nearer virtual hand; reaching forward = smaller/deeper virtual hand.
- Current code maps image-space landmark spread directly into scene geometry and uses wrist-relative landmark Z for finger depth. The earlier size treatment preserved camera perspective, so it did not implement the requested user perspective. Sculpt contact also currently projects onto the clay from screen-space rays rather than using full hand translation in depth.
- Discussed three options: (1) inverse apparent-size mapping as a quick approximation; (2) recommended two-pose near/reach calibration, fixed-size local hand pose, estimated reversed root depth, and virtual-camera perspective; (3) later body/head-referenced tracking to help compensate for posture changes.
- Recommended flow: calibrate near-body and comfortable forward reach with a similar palm pose; estimate a filtered relative reach signal from several stable palm measurements and pose orientation; remove camera-dependent size from the local hand skeleton; translate the fixed-size hand toward/away from the virtual viewer so perspective produces the required apparent size. Avoid applying a second inverse size multiplier on top of perspective. Bound depth, soften jitter, and offer recentering after posture changes.
- Use one transformed hand pose for visuals and clay interaction. Add depth-aware contact feedback and update pull/carve/bulge contact to follow the displayed fingertips. Handle palm orientation and left/right hands separately from root-depth inversion to preserve finger bends and handedness.
- MediaPipe image landmark Z is wrist-relative, and world landmarks are centered on the hand; neither directly supplies absolute hand-to-user distance. Reference: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js . Webcam-only reach remains an estimate, especially with palm rotation, occlusion, or body movement.
- This turn records design options only. Suggested acceptance checks: reaching forward makes the hand recede and appear smaller; bringing it back makes it approach and appear larger; opening/closing or rotating the hand without translating it causes minimal depth drift; visual fingertip contact matches clay deformation.

### 2026-10-03 — Calibrated user-view reach implemented

- User approved option 2 and emphasized that the clay needs an understandable location within their physical reach.
- Added **Calibrate reach** inside the play area, also available in fullscreen. Capture an open palm near the body, then a comfortable forward reach toward the camera. Each capture provides a preparation countdown and collects a steady sample window. Too-similar/reversed endpoints, lost tracking, and a changed hand prevent a successful capture; Start calibration over and Recalibrate reach support retrying.
- Use MediaPipe world landmarks for the local hand pose. Estimate camera-relative translation from the median ratio of image-space palm-edge lengths to their projected world-landmark lengths, with video aspect correction. Invert the calibrated camera-distance range into virtual reach. Keep a calibrated hand scale and let scene perspective make the hand larger near the viewer and smaller farther away. This remains a webcam estimate rather than a measurement of absolute eye-to-hand distance.
- The virtual hand root runs from Z +2.4 at the near pose to Z -2.4 at forward reach. Clay centers remain at Z 0: halfway between the two estimated physical endpoints. Smooth pose/root motion and bound the range; require the calibrated hand and fresh tracking before sculpting.
- Added a You / Clay center / Far depth meter, a selected-clay center-plane frame, an optional floor grid, and a green surface-contact cue. The meter tracks palm/root depth; fingertip contact is checked separately against the clay surface.
- Webcam tool contact now uses the displayed 3D fingertip/grab positions and a narrow signed-distance contact shell, rather than accepting screen overlap. Pull follows 3D hand motion after contact; Carve/Bulge use per-stroke field snapshots so the depth reference remains stable while remeshing. Mouse preview retains its existing screen-based interaction.
- Webcam sculpting is gated until calibration is complete and setup menus are closed. Camera restart requires recalibration. The displayed hand and collision positions share the same coordinates with the previous additional hand Z offset removed in webcam mode.
- Validation: production build passes with the existing bundle-size warning; browser setup UI and fullscreen were inspected, capture remains disabled without a tracked hand, and no console errors were reported. Saved `artifacts/reach-calibration-preview.jpg`. No new automated tests were added or run. Physical two-pose calibration, rotation-induced depth drift, and live contact feel have not been verified with a user's hand and are the next feedback pass.

### 2026-10-04 — Adaptive hand smoothing

- User reported jittery tracking and requested smooth hand flow and sculpted curves.
- Added a three-frame median and speed-adaptive motion filtering for the calibrated palm translation and all 21 local hand landmarks. Depth receives stronger damping; small deadbands suppress stationary tremor. Faster motion increases responsiveness without predicting beyond the measured pose.
- The displayed hand, pinch detection, and sculpting contacts use the same filtered 3D points. The webcam skeleton overlay now uses the existing smoothed image landmarks.
- Pull, Carve, and Bulge ignore tiny webcam displacements until enough motion accumulates, preserving deliberate slow strokes while reducing repeated noise-driven edits.
- Brief tracking losses preserve filter history but pause sculpting immediately. Hide the stale hand after 180 ms; reset filters after longer losses, recalibration, or a different tracked hand.
- Production build passed with the existing bundle-size warning. No automated tests or live webcam movement checks were run. Next user feedback: compare a steady hand, a slow carved curve, and a quick sweep; assess remaining jitter versus perceived lag. Filtering does not resolve tracking occlusion, calibration drift, or mesh-generation frame stalls.

### 2026-10-04 — Local launch reminder

- User again saw unstyled content and oversized artwork after opening the source index.html directly from the drive. ClayPlay must be opened through its Vite server so the JavaScript and imported styles load properly.
- No listener was found on port 5173; started the local development server. Use http://127.0.0.1:5173/ and bookmark that address. For later sessions, run npm run dev -- --host 127.0.0.1 from the project folder and leave the terminal running.

### 2026-10-04 — Detected hand awaiting calibration

- Screenshot shows hand detection working but reach calibration incomplete. The current design hides the virtual hand and gates sculpting until near-body and forward-reach captures are complete.
- Clarified status messages: a valid detected hand awaiting setup now says calibration needed, replacing a stale hand-out-of-view depth label. Capturing and invalid tracking now show separate guidance instead of always asking to start calibration.
- User steps: open Calibrate reach; capture a steady open palm near the body; capture the same hand extended toward the screen; close the panel; move halfway between those positions and look for the green surface-contact cue. Camera restart or page reload currently requires calibration again.
- Production build completed with the existing bundle-size warning. Live calibration with the user's hand remains unverified.

### 2026-10-04 — Sculpting blocked after calibration

- User reported successful calibration but no deformation with any tool.
- Code inspection found that successful capture left the calibration panel open while canSculpt required it to be closed. Completing calibration now closes that panel automatically and returns focus to its summary, releasing the tool gate.
- The webcam contact check also rejected fingertips outside a very narrow 0.12 scene-unit surface band, including fingertips slightly inside the clay. Increased acquisition tolerance to 0.22 and ongoing stroke tolerance to 0.34 to reduce depth-related contact loss. This remains a bounded 3D surface check.
- Surface projection now refines the contact against the edited field and rejects invalid or unconverged results instead of relying on a single distance step. This keeps brushes near the surface after deformation.
- Production compilation checked; no automated tests or physical webcam sculpting performed. User feedback is still needed for contact tolerance and live deformation. Reload the app, calibrate, then try all tools at nonzero Strength; calibration should close automatically and green contact should appear near the surface.

### 2026-10-04 — Recording review: continuity and pinch reliability

- User supplied a 16-second screen recording and reported discontinuous hand movement, interrupted pinch, and excessive sensitivity. Sampled video frames show some deformation (a small bump/tail), so tool execution is not completely blocked. Frame sampling cannot establish precise application latency or inference timings; no audio transcription was performed.
- Code findings: detectForVideo and synchronous field editing/remeshing share the main thread; visible hand updates only when detections arrive. A single missing detection clears pinch and stroke anchors. Calibration rejects the whole mapped pose for uncertain palm geometry or handedness. Median filtering, low cutoff values, per-landmark deadbands, and tool displacement thresholds can accumulate lag or stepped motion. Pinch uses filtered independently moving fingertips and fixed ratio thresholds without timed confirmation. Pull caps displacement per update and advances its cursor, potentially dropping excess movement on long frames.
- Recommended order: add timing/dropout/pinch diagnostics; separate inference and mesh generation from rendering using workers with bounded queues and versioned results; retain gesture and stroke state across brief uncertain periods while pausing edits; filter pinch intent separately from visible pose; use confidence-aware depth stabilization and render interpolation; resample strokes by distance/time with bounded processing, retaining unapplied pull travel. Keep observed contact aligned to the same stabilized pose, and avoid predicted clay edits during genuine tracking loss.
- Acceptance goals for the next implementation: one deliberate held pinch stays one stroke; slow curves do not staircase; normal movement remains responsive during deformation; brief occlusion causes neither a torn stroke nor an unintended bridge; gesture detection and contact loss are shown separately. Profile actual hardware before claiming frame-rate or latency targets.
- This turn diagnoses and proposes solutions only; no tracking or sculpting code changed. Official reference confirming synchronous detection and the worker approach: https://developers.google.cn/edge/mediapipe/solutions/vision/hand_landmarker/web_js

### 2026-10-04 — Movement continuity implementation

- User approved the recommended stabilization order.
- Added optional diagnostics via ?diagnostics=1: render interval, inference time, synchronous field-edit time, mesh generation time, pending mesh bricks, dropout count, pinch state, and pause reason. These are live readings, not measured performance guarantees.
- Moved MediaPipe initialization and detection into a dedicated worker with GPU/CPU delegate fallback, transferable camera frames, one frame in flight, timeout/error handling, and camera-session guards. Discard results older than 250 ms; process current video frames without an inference backlog.
- Moved brick polygonization into a separate shared mesh worker. Coalesce dirty brick requests, send changed field samples instead of complete field copies, transfer position/normal buffers, and discard results from reset or removed objects. Field edits remain on the main thread but are limited to short stroke segments; diagnostics expose their residual cost. Worker errors now pause sculpting with a visible message.
- Added an independent pinch signal using raw world-space normalized fingertip distance, a short filter, separate close/open thresholds, and timed confirmation (55 ms close, 95 ms release). Visual finger filtering no longer determines gesture intent.
- Preserve held gestures for up to 180 ms of tracking uncertainty while pausing deformation. Resume nearby poses by rebasing the input cursor and clearing unobserved path segments; prolonged loss or a large pose change cancels the grab. Do not extrapolate clay edits through missing data.
- Reduced position/pose filter delay and tiny deadbands; kept median filtering for depth. Interpolate the hand at render cadence with a short time constant and pass those same displayed points to the sculpting tools. Temporarily uncertain depth can preserve a visible pose while editing pauses.
- Added bounded stroke-path queues with short spatial steps, preserving sampled bends and remaining pull travel rather than replacing the previous cursor with an unconsumed destination. Overloaded paths rebase rather than bridging stale motion. Tool changes, camera stops, selection changes, and recovery clear stale paths.
- Production build passes, including both worker bundles; the existing main-bundle size warning remains. No automated tests or live webcam checks were run. Browser-specific worker initialization, live tracking latency, mesh lag under sustained pulls, and gesture feel remain for the next user feedback pass. Recommend refreshing, recalibrating, and recording a slow arc, one held pull, and a brief occlusion, optionally with diagnostics visible.

### 2026-10-04 — Tracking worker startup compatibility fix

- User screenshot showed TRACKING UNAVAILABLE, an active webcam feed, and a disabled calibration capture button. Tracking initialization failed before calibration could begin.
- Inspected the installed MediaPipe 0.10.35 API and runtime: forVisionTasks accepts useModule, defaulting to false. The new module worker was requesting the classic runtime. Changed worker initialization to request the ES-module runtime explicitly.
- Added automatic fallback to the previously used main-thread GPU/CPU tracking path if worker initialization fails, including worker-constructor failures. Compatibility mode limits inference scheduling to approximately 15 frames per second while retaining background mesh generation and the continuity changes. Diagnostics expose the selected mode.
- Guarded late initialization failures after camera shutdown and updated failure wording so it does not imply that internet connectivity is always the cause. Worker and fallback errors remain available in the console.
- Production build passes with the existing bundle-size warning. Live browser initialization and webcam calibration have not been verified in this turn. Refresh the current localhost page, restart tracking, and calibrate once the webcam landmark overlay appears.

### 2026-10-05 — Distinguishing runtime failure from missing hand detection

- Screenshot shows Tracking paused after initialization, with a working camera and no landmarks. The exact visible prompt maps to the trackingLoop catch block: frame capture/inference OR landmark processing threw an exception, then the loop returned permanently. The old UI misleadingly continued to say looking for hand. Startup fallback does not handle these runtime exceptions.
- Browser inspection failed twice because its automation kernel could not initialize, so the underlying browser exception has not been retrieved. Do not claim that the screenshot proves a specific GPU, MediaPipe, or calibration fault.
- Added visible error details including tracking mode, failed phase, exception name, and message; retain worker error names/stacks. On failure, close the broken tracker, pause sculpting, show TRACKING ERROR, and make Retry tracking reconnect while retaining the camera stream.
- User must reload and reproduce once, then share the error-details message below the play area to establish the exact underlying cause. The diagnostic change fixes misleading error state and retry handling; it does not claim to fix the unknown exception.
- Production build passed with the existing bundle-size warning. No live browser reproduction was possible in this session.

### 2026-10-05 — Confirmed frame-inference worker timeout

- User supplied the exact error: worker / frame capture-inference / Tracking worker timed out. This confirms worker initialization completed but a frame request did not receive a response within the three-second deadline. It does not distinguish slow first inference, a stalled runtime, or a browser/GPU problem without further profiling.
- Added automatic runtime recovery for worker capture/inference exceptions: terminate the failed worker, pause edits, start compatibility GPU/CPU tracking against the live video, reset reach calibration, and resume the frame loop. Previously fallback only covered initialization errors.
- After a worker failure, subsequent tracker creation in the same page session prefers compatibility mode, avoiding repeated worker failures on Retry tracking. Recovery failures include their error in the visible diagnostic text. Epoch guards prevent old recovery attempts taking over a stopped/new camera session.
- Production build passed with the existing bundle-size warning. Automatic recovery and physical hand detection still require live browser confirmation; no claim that the underlying worker/browser stall has been eliminated.

### 2026-10-05 — Brush size control

- User requested a Size slider alongside Strength, ranging from 10% to 90% of the existing shape. Implemented Size as the sculpting brush diameter relative to the selected shape's original largest dimension (sphere diameter 2.5 local units).
- Added a labeled, keyboard-accessible 10–90% slider with live percentage readout beneath Strength. Default 24% preserves the sphere's previous pinch radius of 0.3. Pinch, Carve, and Bulge share the chosen brush size; Strength continues to control pull gain, carve depth, or bulge amount separately.
- Reference sizes are stable during deformation and follow object layout scaling. Changing size ends the current stroke to avoid mixing brush widths unexpectedly. The calibration panel was moved down and its scrolling height adjusted to make space in normal, narrow, and fullscreen layouts.
- Production build completed with the existing bundle-size warning. No automated tests or browser/webcam walkthrough performed. Large brushes affect more field samples and may increase synchronous sculpting cost.

### 2026-10-05 — Open-palm Knife tool

- Added Knife to the tool selector. In calibrated webcam mode, a steady open palm (four extended fingers and separated thumb) arms a visible blade. Sweep in one plane until the blade exits the selected clay; close and reopen the hand before another cut. Mouse mode supports dragging the blade through the clay.
- The blade is nine local units long, exceeding the diagonal of the editable clay volume, and follows object display scale. Strength and Size are disabled for Knife because it performs a full cut with a fixed full-length blade.
- A completed sweep sends the current sculpted field to a separate worker. Occupied voxel samples estimate volume on each side of the palm-oriented plane. Remove the smaller side; equal estimates deterministically keep the negative half. A nonintersecting or negligible cut makes no change.
- Apply a half-space cut to the base field and existing edited samples, then remesh the retained clay with a closed planar face. Subsequent Pinch, Carve, and Bulge edits can modify that face. Reset restores the original shape. Snapshot and mesh-worker messages now preserve prior cuts.
- Tracking loss, a changed cutting plane, tool/menu changes, or an incomplete sweep cancel the unfinished gesture. Pending cuts are ignored after object reset/removal. Field edits pause while the selected object's cut is calculated; worker errors/timeouts show retry guidance.
- Production build passed with the existing bundle-size warning. No automated tests or live hand/mouse walkthrough performed. Side selection is a voxel-volume estimate, and an irregular object can contain multiple components within either retained/discarded half-space. Live open-palm thresholds and sweep feel need user feedback.
