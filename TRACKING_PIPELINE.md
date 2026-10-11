# Mask studio tracking

## Findings

The recording shows the small index pointer following a moving finger in the
fullscreen camera view. That pointer previously moved only when a hand result
arrived; it was separate from the virtual hand's smoothing.

The default tracker detects two hands on the CPU to preserve rendering GPU
capacity and support automatic resizing. Its old cadence was at least 50 ms,
or 1.5 times inference duration on slower devices. The camera was capped at
30 fps. Capture, resizing, worker inference, and waiting for another animation
frame further delayed input. The virtual hand additionally passed through two
fixed exponential filters (25 ms and 12 ms time constants).

These are implementation findings, not a measurement of camera-to-display
latency from the recording.

## Applied pipeline

1. Request up to 60 fps, accepting the camera's available rate.
2. Schedule capture from video-frame callbacks. An animation-frame watchdog
   handles browsers that suppress those callbacks when fullscreen hides the
   preview; browsers without the API also use animation frames.
3. Allow one inference per model in flight. Remember only the newest available frame's
   metadata while busy, then capture it when inference is available. Drop old
   frames rather than building a queue. Cancel scheduling on shutdown and retry.
   Keep the hand pump running for UI selection during face try-on.
4. Keep capture/presentation timestamps through processing. Reject results
   aged 200 ms or more before they can affect sculpting. UI feedback has a
   separate 500 ms sample-age bound, so a delayed result can maintain a pointer
   without extending an edit.
5. Use one adaptive filter per consumer, in normalized camera coordinates.
   Resting motion gets stabilization; faster movement increases the cutoff.
   UI and studio filters run independently, rather than in series. Reset on
   hand changes and tracking gaps.
6. Render the pointer and virtual hand at display cadence. Estimate movement
   between result arrivals for at most 24 ms and 0.015 normalized units. Require
   consistent direction; disable extrapolation at a stop or reversal. Use
   receipt time for this bounded display motion so inference cannot consume
   its entire horizon before the result arrives. Capture time still controls
   filter sampling and staleness.
7. Keep held pull/cut/erase positions on filtered measurements. Gesture intent
   uses fresh raw landmarks, and control dwell/activation uses fresh filtered
   measurements. Drawing a predicted cursor cannot activate a control or edit
   the mask. Pinch geometry is previewed on the GPU and committed by a worker
   after release; erasing workers sweep paths between samples.

## Cursor visibility and button selection

The first smooth-motion implementation hid the cursor on any missing detection
and at 200 ms source age, cancelling hover each time. That produced the blinking
seen in the follow-up recording, even while a finger remained visible.

UI tracking now has separate tracked, temporarily missing, and lost behavior:

- A brief miss holds the last painted cursor and highlight. No extrapolation
  or button activation runs during the gap.
- Dwell pauses at the last confirmed sample and resumes on the same button,
  excluding missing time. A pause longer than 450 ms discards the countdown.
- The cursor remains visible for up to 650 ms after its last accepted result.
  Longer absence clears it; shutdown and tracking failure clear it immediately.
- Control-hand identity is reserved for the same visibility grace period, so a
  different hand cannot inherit the paused countdown.

This grace is specific to UI feedback. Missing/old tracking still pauses mask
edits immediately under their existing freshness rules.

## Pinch reliability

The pinch follow-up exposed three ways measured drag distance was lost:

- Release finalized only the last installed worker preview. A fast stroke
  released before its first preview committed zero movement; a later release
  could commit only the small initial portion of a longer drag.
- The UI hand-ownership path treated a missing detection as a hand change and
  ended a held stroke, bypassing the existing sculpt tracking grace period.
- Reacquisition reset the drag origin, discarding movement made between valid
  detections. Repeated gaps could reduce a substantial pull to tiny segments.

Release freezes input at the last measured held target and sends one final
worker job for that target. The GPU keeps displaying the frozen shape until
the matching geometry is installed, then disables the preview in the same
turn. Open-hand frames cannot update the frozen target. A pinch without
movement remains an exact no-op with no history entry.

A missing controlling hand pauses the existing grab for the sculpt grace
period (700 ms) instead of transferring input to the UI. Same-hand recovery
retains the original drag origin. No positions are extrapolated during gaps;
source frames aged 500 ms or more cannot deform the mask. Long loss,
hand changes, and large recovery jumps still end the stroke.

Confirmed held pinch positions are consumed on result arrival as well as
being displayed in the render loop. This prevents the next paint or a release
from overwriting a valid measurement before its freshness deadline.

Browser regression checks use real geometry workers with preview delivery
delayed by 350 ms. They cover release before the first preview, latest-target
commit, exclusion of open-hand movement, repeated missing detections, stale
source frames, recovery without rebasing, long-loss release, hand changes,
and exact Undo/Redo. Hand inference is simulated in these checks.

## Continuous live deformation

The second pinch recording showed that preserving final input was not enough:
the live mesh still waited for worker previews, and the fixed 200 ms source-age
cutoff repeatedly paused otherwise steady tracking. Pinch rendering now runs
the same invertible flow and normal transformation on the GPU, directly from
the undeformed source mesh. The shader is attached when the mask is created,
so starting a grab does not require a new shader compilation. Contact vertices
are inserted using the same helper on the UI and worker paths, including for
fine brushes. Source geometry and authoritative field stay unchanged during
the hold; the final job commits that exact measured target once.

The displayed flow approaches the latest measured target at display cadence
with a 12 ms time constant. This interpolates between samples without predicting
unseen movement or accumulating deformation error. Worker preview jobs are no
longer sent while held. Clearly closed pinches engage on the first frame;
borderline closure retains its short confirmation. An established grab keeps
ownership if the outer fingers relax or curl; a full fist still invokes Move.
The 0.003 local-unit movement gate is reduced to duplicate-sample suppression,
so slow, small measured movements are also visible.

Release intent uses raw thumb/index separation rather than the displayed finger
filter. The previous fixed release threshold was 0.55 palm widths, so a partial
opening could still drive the patch for several measurements. The threshold now
adapts to the tightest measured grip plus a 0.14 margin, bounded to 0.36–0.48 palm
widths. The first frame crossing it releases without a confirmation delay, before
that opening frame's index position can move the patch. After release, a definite
closure below 0.30 is required to regrab; opening/threshold jitter cannot start
another stroke. Closed-finger noise stays within the hold band. This reduces the
extra opening required by gesture logic; camera and inference delay still precede
the first measurable release frame.

Freshness now distinguishes source age from missing results. A newly returned
measurement less than 500 ms old is accepted; a 300 ms interval without a new
result pauses input. A steady 230 ms camera/inference delay no longer creates
false loss/recovery cycles on each result. Actual missing detections still
pause immediately, and old frames, hand changes, prolonged loss, and shutdown
cannot keep driving a stroke.

The continuous-pinch browser regression delays commit delivery by 500 ms and
simulates 230 ms source delay. It verifies immediate grab, interpolation across
display frames, zero worker preview jobs while held, relaxed outer fingers,
release at 0.38 palm widths with a simultaneously moving index, no regrab during
partial-opening jitter, frozen release, and exact Undo/Redo. A WebGL2 transform-feedback check compares
720 GPU positions and normals with the CPU flow across symmetry settings and
1%, 3%, and 24% brush radii: maximum errors were 0.000013 local units for position
and 0.000056 for normal components. These are synthetic correctness checks,
not a benchmark of the user's live webcam or GPU.

The retained regression is `tests/continuousPinch.browser.cjs`. With Playwright
available and the Vite development server running, execute it with Node. Its default URL
is `http://127.0.0.1:5174/?diagnostics`; `CLAYPLAY_TEST_URL` overrides this,
`PLAYWRIGHT_MODULE_PATH` can point to an existing Playwright installation, and
`PLAYWRIGHT_BROWSER_CHANNEL` chooses the installed Chromium browser (Edge by
default). The test also exports a function accepting an existing Playwright
Page for integration into a browser-test harness.

Automatic two-hand tracking now has a 33 ms minimum interval and a 10% CPU
margin above an averaged inference duration, retaining the existing 512 px
capture width and 200 ms upper backoff bound. Single-hand capture remains
640 px. The CPU delegate and existing slow-device fallback remain in place;
actual inference speed must be measured before changing that tradeoff.

## Validation and profiling

Run `npm test` and `npm run build`. Motion tests cover stationary jitter,
30/60 Hz movement against the previous two-stage filter, slow inference,
bounded prediction, stops, turns, invalid input, and reacquisition. Scheduling
tests cover single-flight inference, frame dropping, backoff deadlines, hidden
previews, unsupported browsers, cancellation, and restart during inference.

Synthetic constant-speed movement at ideal timestamps reduced mean normalized
position error from 0.01310 to 0.00189 at 30 Hz and from 0.01203 to 0.00349 at
60 Hz. These isolate filter/display behavior; they do not establish a live
webcam latency improvement of the same size.

Browser checks used a 60 fps synthetic camera with 35 ms simulated inference:
the pointer advanced on 46 display frames between tracking results during a
90-frame observation, with peak inference concurrency of one. Camera
shutdown/restart resumed tracking without queued captures. A follow-up browser
check dropped every fourth hand result while simulating 230 ms of upstream
camera delay: the cursor stayed visible in all 120 observed display frames,
the button activated exactly once, and prolonged loss eventually hid it. Camera
shutdown still cleared it immediately. Separate browser checks passed hand-selected erasing, immediate
release, one-step Undo/Redo, symmetry, later pulls preserving erased holes, and
cursor fallback. These exercise the real studio and geometry workers, while
hand inference is simulated; they do not benchmark the live camera/model.

Open the studio with `?diagnostics` to inspect:

- `cameraHz`: camera track's negotiated frame rate.
- `trackingHz`: interval between successive inference starts.
- `captureMs`: bitmap creation/resizing cost.
- `inferenceMs`: model execution cost in the worker.
- `roundTripMs`: capture request to returned result, including worker transport.
- `resultAgeMs`, `pointerAgeMs`, `poseAgeMs`: source-frame age at each stage.
- `frameTiming`: `capture`, `presentation`, or `callback`. Only `capture`
  represents the camera's capture clock; the others omit upstream camera delay
  and are lower bounds.
- `predictionMs`: bounded visual extrapolation horizon for the studio hand.
- `frameMs`, `pullInstallMs`, `meshMs`: rendering and geometry-update costs.

Compare pointing at rest, fast sweeps, direction reversals, pinch release,
two-hand resize, and active erasing on the same device and lighting. A 60 fps
camera request does not guarantee 60 Hz tracking; inference and exposure can
still limit it. Sub-frame visual feedback cannot remove camera latency or
recover measurements that were never captured.

## Resizing after deformation

The October 11 recording replay detects both visible hands, but they are open
palms. Closed fists remain the resize gesture; open palms now show an explicit
"Both hands detected · close both fists to resize" hint. Fist classification
requires a curled index as well as two other curled fingers, so a sculpting
pinch with relaxed outer fingers cannot become a resize grip.

Two additional control paths could prevent resizing after sculpting:

- Five inference frames above 120 ms permanently restarted tracking with only
  one hand. The existing single-flight scheduler and adaptive interval now
  handle slow bursts without disabling the second hand. Compatibility-mode
  reconnection also requests two hands, falling back to one only if that
  configuration actually fails.
- Resize intent was gated by the previous pinch state. A complete two-fist
  pose now explicitly finishes the last measured deformation. Resizing waits
  for pull/erase/cut workers and pending geometry to finish, shows a saving
  hint, then establishes its baseline while the fists remain held. A closed
  options panel's single-hand reopening gate cannot block this two-hand intent.
  An open panel or paused editing still owns input.

`tests/resizeAfterSculpt.browser.cjs` exercises the real render loop and geometry
workers with simulated hand inference, 150 ms inference bursts, and delayed
geometry delivery. It checks direct pinch/erase transitions, repeated resizing,
release and one-hand loss, exact geometry and size history, and two-hand
compatibility recovery. Run it against the dev server with Playwright installed
(or set `PLAYWRIGHT_MODULE_PATH`), as with the continuous-pinch browser check.
The diagnostic fields `detectedHands` and `resize` distinguish detection from
gesture/placement/saving gates. Recording replay is evidence that these frames
contain recognizable hands, not a measurement of the user's live tracker state.

## Index selection during Try On

Try On previously stopped the ordinary hand pump and serialized hand and face
inference in one loop. A slow face job could push successive hand results more
than 300 ms apart, resetting the UI's safe dwell countdown. Try On also discarded
hand results after 350 ms, although the UI accepts source samples below 500 ms.

The same latest-frame hand pump now serves sculpting and Try On. Face tracking
runs independently on its own worker, with at most one request per model; the
hand interval remains adaptive with an 80 ms minimum in Try On. Source timestamps
and normal UI freshness checks are preserved. Try On only routes hand results
to the UI. A frame selecting Back to creating cannot also sculpt. Mode changes
restart the same pump so pending hand inference cannot overlap another hand job,
and epoch checks discard results from the previous mode.

`tests/tryOnHandUI.browser.cjs` reproduces the old More-button failure with
320 ms face inference and 70 ms hand inference. It checks More, color/finish,
single activation while stationary, hand/face loss, hand-selected return, mode
changes during pending inference, resumed tool selection, and camera shutdown, using simulated
tracking and the real studio/render loop. These checks do not measure live-model
performance under concurrent CPU load.

References: [MediaPipe hand tracking and worker guidance](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js),
[video-frame callbacks and timing metadata](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback),
[adaptive speed-based filtering](https://gery.casiez.net/1euro/).
