# Mask Studio: pinch and pull UX review

## Evidence and scope

Reviewed the supplied 16.53-second screen recording using frames sampled every 0.5 seconds, the current tracking/sculpting implementation, and an isolated pull benchmark. This is a diagnosis and implementation recommendation; the application has not been changed by this review.

The recording does not include timing diagnostics. Exact tracking latency, worker mode, mesh processing time, and the cause of each individual pause cannot be established from the recording alone.

## Observed experience

- Around 3 seconds, the hand is visible but the interface asks the user to find the surface. The user must align both screen position and estimated depth.
- Around 6 seconds, a small green contact cue appears. It communicates contact, but not the area that will deform.
- Around 8–10 seconds, the interface reports an active pinch and pull. The visible shape change is modest.
- Around 11–12 seconds, the upper-right mask edge develops a notch/cavity as the hand moves outward. The expected attached stretch does not follow the fingers.
- At 12 seconds, the interface still says “Holding clay · pull to shape” despite the visible separation between hand and mask. An internal grab variable is being presented as evidence of a successful physical grab.
- Around 15 seconds, the UI praises the result with “Lovely shape,” even though the visible result does not match the user's intent.

The main usability problem is uncertainty: users cannot tell whether they missed the surface, lost tracking, are waiting for geometry, or successfully pulled material.

## Causes supported by the code

### Pull computation blocks drawing

`renderScene` calls `processHandPose`, which calls `applyPull` on the main thread. The deformation samples and updates a three-dimensional voxel region. Mesh extraction is in a worker, but the deformation itself is not.

An isolated eight-step benchmark of the full mask at radius 0.336 and strength 0.55 took approximately 24–55 ms per pull call. The benchmark excluded mesh rebuilding, rendering, camera capture, and inference. It used a synthetic outward path and is not a measurement of the recorded session. Nevertheless, the cost exceeds a 16.7 ms frame budget for 60 Hz drawing.

Large brushes expand the sampled volume rapidly. Higher strength can increase the number of internal deformation steps. This makes simple slider changes capable of worsening responsiveness.

### Mesh updates arrive in batches

The mesh queue sends all pending bricks for a volume to one shared worker. Results are applied together; replacement geometries and their bounding spheres are created on the main thread. Tracking, the edited field, and the displayed surface can consequently represent different moments.

### Tracking has multiple pause gates

- A displayed pose older than 160 ms pauses interaction.
- An inference result older than 250 ms is rejected.
- A tracking gap longer than 180 ms cancels the stroke.
- Uncertain estimated depth disables sculpting immediately.
- A sufficiently large movement on reacquisition cancels the stroke.

These gates prevent unwanted jumps, but a short delay can feel like an unexplained release. Blocking deformation can also delay processing of otherwise available tracking results.

### Depth acquisition is difficult

The current hand mode requires the pinch midpoint to be close to the three-dimensional surface, then iteratively projects it onto the field. Depth is estimated from calibrated apparent palm geometry. Changes in orientation, occlusion, and noisy estimates can make acquisition harder even when the fingers appear over the mask.

Depth and finger poses are filtered separately, followed by render interpolation. Pinch intent also has smoothing and a 55 ms hold confirmation / 95 ms release confirmation. These filters serve different purposes, but their total perceived delay needs measurement.

### Pull follows an advancing point rather than preserving the original grabbed patch

The pull operation repeatedly resamples a local field and advances its brush center. Strength multiplies displacement: at the recorded strength of 55, the multiplier is 1.5. The internal anchor can therefore move farther than the cursor movement. The code does not verify that the returned anchor is still attached to a meaningful piece of material.

Thin mask shells are particularly vulnerable to local thinning, cavities, and disappearing material under repeated field resampling. The visible notch is consistent with this weakness, although the recording alone cannot isolate its numerical cause.

The mask starter change reused the previous sphere-oriented deformation method. Existing tests check strength on a sphere; they do not validate continuity, thickness, attachment, or shape preservation on masks. Passing those tests did not establish satisfactory mask pulling.

### Path backlog can abandon a grab

`StrokePath` limits each pull path step to 0.04 units and clears its queue after more than 48 pending points. The caller then clears the grab. If input outruns processing, the user can experience delayed motion followed by a lost grab. Whether that limit was reached in this recording is unknown.

### Compatibility tracking is a conditional extra source of stalls

The fallback tracking path executes inference on the main thread and has a minimum interval of 65 ms. It can compete with drawing and deformation. The recording does not establish whether fallback mode was active.

MediaPipe documents that JavaScript detection calls are synchronous and recommends workers to avoid blocking the interface: [official Web hand tracking guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js).

## Recommended interaction design

### Default to forgiving screen-space grabbing

For initial mask creation, use finger position to aim at the visible mask surface. Highlight a generous eligible patch before the user pinches. Do not require exact estimated depth just to begin a grab.

Use the front visible surface, avoid accidentally selecting the back shell, and make eye openings visibly unavailable. Offer calibrated depth interaction as an optional advanced mode.

### Preserve a stable grab until release

On pinch, store the original surface patch and hand origin. Compute the deformation target from total hand displacement relative to that origin. Keep the control point following the hand approximately one-to-one; let strength affect softness or falloff rather than unexpectedly multiplying cursor travel.

A short uncertain interval should suspend geometry edits and retain the grab state. Show an amber cue, keep the hand visually understandable, and rebase movement on reliable reacquisition. Do not apply speculative deformation during a dropout or replay an old motion backlog.

### Use mask-aware deformation

Prototype dragging a connected patch of the existing surface with smooth falloff and a thickness constraint. Keep eye boundaries and untouched regions stable. A topology-preserving surface deformation approach is a promising starting point for shells; compare it with a corrected field-based pull before replacing the volume system used by other tools.

The desired outcome is a connected cheek, brow, ear, or horn that follows the gesture without leaving a cavity or detached fragment.

### Keep feedback immediate

- A visible cursor and brush footprint show where the action will happen.
- A green highlight means ready to grab.
- A tether between the original patch and finger target explains the active pull.
- An amber state means movement is temporarily paused.
- A neutral release message confirms completion; praise should not imply that any edit was successful.
- Add prominent undo/redo so experimentation feels safe. Currently the visible recovery is a whole-mask reset.
- Make the large hand visualization translucent or hide it near the selected patch so it does not obscure the result.

## Engineering priorities

1. Measure capture-to-result age, hand display age, deformation duration, mesh wait time, geometry installation duration, queue length, and exact pause reasons. Report distributions rather than only the most recent value.
2. Remove heavy pull computation from the drawing loop. Keep immediate lightweight feedback and serialize authoritative deformation work in a worker.
3. Bound geometry work per update and prioritize the active patch. Coalesce compatible pending edits without losing the user's final target or replaying stale paths.
4. Implement forgiving acquisition and a persistent grab state with explicit temporary suspension.
5. Correct thin-shell deformation and cursor/strength mapping.
6. Add undo/redo and simplify instructions to “Point → Pinch → Drag → Release.”

Avoid tuning tracking confidence thresholds blindly. Distinguish inference failure, depth uncertainty, main-thread blockage, and mesh delay first.

## Validation before declaring a fix

- Replay recorded hand trajectories into the interaction pipeline; a screen recording alone cannot replay raw landmark data accurately.
- Compare worker and compatibility modes on the user's target device.
- Test slow and fast pulls, direction changes, large brushes, short dropouts, release during processing, and reacquisition.
- Test all three masks at eye rims, cheeks, brows, and outer edges.
- Verify connected geometry, retained thickness, stable eye openings, no unintended cavities, and predictable displacement.
- Check undo restores the exact previous state.
- Aim initially for smooth 60 Hz feedback where hardware permits, visible grab acknowledgement within roughly 100 ms, and no unexplained releases. These are proposed targets, not verified current performance.
- Run beginner sessions: users should complete a deliberate first pull without coaching and understand how to reverse it.

## Recommendation

Prioritize a reliable, forgiving grab-and-drag experience and shell-safe deformation before adding marketplace or engagement features. The creative reward depends on users being able to predict what their hands will do to the mask.
