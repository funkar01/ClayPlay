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
- Confirmed in-browser that the webcam stays on and MediaPipe reaches its “looking for hand” state. The “Done when” check remains open until landmarks are visibly detected in ordinary indoor light and loss/reacquisition behavior is confirmed.

### Milestone 2 — First clay interaction

**Goal:** Make the clay respond to one clear hand action.

Sub goals:
- Add a clay sphere with a soft, appealing material.
- Map the hand’s movement to a visible interaction point on the clay.
- Detect a pinch with separate start and release thresholds to prevent flicker.
- Pull nearby clay vertices while pinching.
- Show a visible cue when the pinch is active.
- Add a reset button in case the clay gets misshapen.

**Playable result:** Pinch and pull the sphere to make a lump or tail.

**Done when:** A first-time player can make the clay move within a minute, and release stops the pull reliably.

**Implementation status — first interaction prototype ready for a try**

- Added a soft terracotta icosphere to the studio and kept it visible before camera setup.
- Added thumb-to-index pinch detection normalized by palm width, with separate pinch and release thresholds to reduce flicker.
- Maps the pinch point onto the front of the clay and pulls a local patch with a smooth falloff while the pinch moves.
- Added an active pinch cue, first-use shaping prompts, and a reset control.
- Mouse mode now supports click-and-drag sculpting through the same deformation path, so the interaction can be explored without a camera.
- Merged the icosphere vertices so the surface stays smoothly shaded after deformation; softened the hand overlay so it does not obscure the clay.
- Confirmed the production bundle builds. Webcam pinch recognition and the feel of the deformation still need a hands-on try before this milestone is complete.

**Feedback to collect on the first try**

1. Is it clear where to put your hand and when the pinch is active?
2. Does the clay start moving at the right point, or does it feel offset from your fingers?
3. Does the pull feel too weak, too strong, too lumpy, or too slow?
4. Does releasing reliably stop the deformation?
5. Does reset behave as expected?

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

Try Milestone 2 in mouse mode first with click-and-drag, then set up the camera and try pinching over the clay. Share what feels satisfying, confusing, weak, or unreliable; we’ll tune pinch thresholds, cursor alignment, and pull strength from that feedback. Milestone 1’s hand detection still needs confirmation in ordinary indoor light as part of the webcam try.

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
- Production build succeeds. The next step is hands-on feedback on alignment, gesture reliability, and deformation feel; webcam behavior has not yet been confirmed in a real session.
