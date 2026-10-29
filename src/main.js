import { StudioFeedback } from './studioFeedback.js';
import { SelfieStudio } from './selfie.js';
import { brushApplying, deformationApplying } from './brushAvailability.js';
import { ComfortSetup } from './comfortSetup.js';
import { PalmControl } from './palmControl.js';
import { PaintPicker } from './paintPicker.js';
import { SculptSounds } from './sculptSounds.js';
import * as THREE from 'three';
import { ClayObjects } from './clayObjects.js';
import { setupClayMenu } from './clayMenu.js';
import { ReachCalibration } from './reachCalibration.js';
import { setupFullscreen } from './fullscreen.js';
import './style.css';
import { TrackingClient } from './trackingClient.js';
import { VideoFramePump } from './videoFramePump.js';
import { HandMotion } from './handMotion.js';
import { HAND_SOURCE_MAX_AGE_MS, usableHandSample, currentHandPose } from './handTrackingTiming.js';
import { PinchGesture } from './pinchGesture.js';
import { diagnostics } from './diagnostics.js';
import { trackingTrace } from './trackingTrace.js';
import { SurfacePull } from './surfacePull.js';
import { SurfaceExtrude } from './surfaceExtrude.js';
import { SurfacePaint } from './surfacePaint.js';
import { CLAY_COLORS } from './clayAppearance.js';
import { SurfaceCut } from './surfaceCut.js';
import { SurfaceErase } from './surfaceErase.js';
import { checkpoint, checkpointScale, applyMaskScale, checkpointPosition, applyMaskPosition, restoreHistory } from './sculptHistory.js';
import { CameraBackdrop, cameraCoverPoint } from './arView.js';
import { MaskTryOn } from './tryOn.js';
import { TwoHandScale, palmCenter, closedFist } from './twoHandScale.js';
import { PalmMove, PalmGesture, closedPalm } from './palmMove.js';
import { HandUI, HAND_UI_SAMPLE_AGE_MS } from './handUI.js';
import { StudioTutorial } from './studioTutorial.js';
import { MaskShapePicker } from './maskShapePicker.js';
import { tutorialApplying } from './tutorialProgress.js';
import { StudioBackdrop } from './studioBackdrop.js';
import { MASK_SHAPES } from './clayShapes.js';
import { inject } from '@vercel/analytics';

// Count page views in deployed builds, keeping development sessions out.
if (import.meta.env.PROD) inject({ mode: 'production' });

const sculptSounds = new SculptSounds();
document.addEventListener('pointerdown', () => sculptSounds.unlock());
document.addEventListener('keydown', () => sculptSounds.unlock());
document.addEventListener('visibilitychange', () => { if (document.hidden) sculptSounds.stop(); });
window.addEventListener('blur', () => sculptSounds.stop());
const video = document.querySelector('#camera-video');
const previewCanvas = document.querySelector('#preview-overlay');
const previewContext = previewCanvas.getContext('2d');
const cameraButton = document.querySelector('#camera-button');
const mouseButton = document.querySelector('#mouse-button');
const statusPill = document.querySelector('#tracking-pill');
const trackingText = document.querySelector('#tracking-text');
const promptTitle = document.querySelector('#prompt-title');
const promptBody = document.querySelector('#prompt-body');
const promptCard = document.querySelector('#prompt-card');
const buttonLabel = document.querySelector('#button-label');
const sceneHint = document.querySelector('#scene-hint');
const studioMessage = document.querySelector('#studio-message');
const studioMessageOK = document.querySelector('#studio-message-ok');
const scenePlaceholder = document.querySelector('#scene-placeholder');
const stageCaption = document.querySelector('#stage-caption');
const cameraStatus = document.querySelector('#camera-status');
const videoPlaceholder = document.querySelector('#video-placeholder');
const videoLive = document.querySelector('#video-live');
const cameraPreview = document.querySelector('.camera-card');
cameraPreview.classList.add('stage-camera-preview');
cameraPreview.hidden = true;
document.querySelector('#stage').append(cameraPreview);
const tipHeading = document.querySelector('#tip-heading');
const tipCopy = document.querySelector('#tip-copy');
const landmarkCount = document.querySelector('#landmark-count');
const resetButton = document.querySelector('#clay-reset');
const undoButton = document.querySelector('#sculpt-undo');
const redoButton = document.querySelector('#sculpt-redo');
const toolButtons = [...document.querySelectorAll('[data-tool]')];
document.querySelector('.axis-gizmo').hidden = !import.meta.env.DEV;
const strengthInput = document.querySelector('#tool-strength');
const strengthValue = document.querySelector('#strength-value');
const strengthContext = document.querySelector('#strength-context');
const sizeInput = document.querySelector('#tool-size');
const sizeValue = document.querySelector('#size-value');
let paintColor=CLAY_COLORS[4][1];
const paintPicker=new PaintPicker(document.querySelector('#stage'),paintColor,color=>setPaintColor(color,true));
const paintPalette=paintPicker.element;
function setPaintColor(color,fromPicker=false) {
  cancelMouseStroke();paintColor=color;
  if(!fromPicker)paintPicker.setColor(color);
}
const surfaceStatus=document.createElement('div');
surfaceStatus.className='surface-status';surfaceStatus.hidden=true;
surfaceStatus.setAttribute('role','status');surfaceStatus.setAttribute('aria-live','polite');
document.querySelector('#stage').append(surfaceStatus);
let activeSize = Number(sizeInput.value);

// Brush diameter as a fraction of the shape's original largest dimension.
// Local units automatically follow the selected object's scene scale.
function brushRadius() {
  const referenceRadius = { full: 1.4, half: 1.04, animal: 1.77 };
  return (referenceRadius[clayVolume.shape] ?? 1.25) * activeSize / 100;
}

const connectionLines = [
  [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[17,0], [0,5],[0,17],
];

const pinchGesture = new PinchGesture();
const palmControl = new PalmControl();
let palmControlState=null;
let controlMode='palm';
try { const saved=localStorage.getItem('clayplay-control-mode'); if(['index','palm'].includes(saved))controlMode=saved; } catch {}
function setControlMode(mode) {
  if(!['index','palm'].includes(mode) || mode===controlMode)return;
  cancelMouseStroke();setResizeMode(false);finishMoveStroke();
  controlMode=mode;palmControl.reset();palmControlState=null;handMotion.reset();
  poseTarget=null;poseDisplayed=null;smoothedPoints=null;handUI?.reset();
  try {localStorage.setItem('clayplay-control-mode',mode);}catch{}
  showToolInstructions();
}

const handMotion = new HandMotion({ staleMs: HAND_SOURCE_MAX_AGE_MS });
const twoHandScale = new TwoHandScale();
const palmMove = new PalmMove();
const palmGesture = new PalmGesture();
const movePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
let moveIntent = false, moveTarget = null, moveSaved = false, moveReceivedAt = 0, movePhase = null;
const positionResetButton = document.querySelector('#position-reset');
let resizeEnabled = false, resizeSaved = false;
let resizeAutoPaused = false;
let singleHandNeedsOpen = false;
let resizeTargetScale = null;
let resizePhase = null, lastResizeHandAt = 0;
const resizeButton = document.querySelector('#resize-toggle');
let poseTarget = null;
let poseDisplayed = null;
let poseSampleAt = 0, poseScreenSpace = true;
let lastCaptureAt = null;
let gapStartedAt = null;
let previousRenderAt = performance.now();
let trackingEpoch = 0;
let stream;
let cameraOpening = false;
let cameraStartup;
let cameraRequestEpoch = 0;
let arStartedCamera = false;
let arAction = 0;
let faceTracker, faceAbort, faceFrame;
let selfie;
let faceEpoch = 0, lastFaceVideoTime = -1, nextFaceTrackingAt = 0;
let tryPreviousAR = false, tryStartedCamera = false;
let tryHandWasDone = false;
let tryPhase = null;
let lastTryHandAt = -Infinity;
let handUI = null, handUICaptured = false, editingPaused = false;
let studioTutorial;
let maskShapePicker;
let landmarker;
let animationFrame = 0;
let lastHandAt = 0;
let noHandSince = 0;
let wasTracking = false;
let smoothedPoints = null;
let videoWidth = 0;
let videoHeight = 0;
let handFramePump;
let mousePinching = false;
let mousePointerId = null;
let pinchActive = false;
let pinchHasContact = false;
let previousPullPoint = null;
let previousPullCursorPoint = null;
let grabCursorOrigin = null;
let grabAnchor = null;
let recentGrabHit = null;
let recentGrabAt = 0;
const pullPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
let symmetryEnabled = true;
let activeTool = 'pinch';
let cutStroke = null;
const symmetryButton = document.querySelector('#vertical-symmetry');
let activeStrength = Number(strengthInput.value);
let lastPinchHint = false;

const sceneHost = document.querySelector('#three-scene');
const scene = new THREE.Scene();
const studioBackdrop=new StudioBackdrop({scene,stage:document.querySelector('#stage')});
const studioFeedback=new StudioFeedback(document.querySelector('#stage'));
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0, 8.6);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(sceneHost.clientWidth, sceneHost.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
sceneHost.appendChild(renderer.domElement);
const arButton = document.querySelector('#ar-toggle');
const arView = new CameraBackdrop({ video: document.querySelector('#ar-camera-video'), button: arButton,
  stage: document.querySelector('#stage'), scene, renderer,
  onChange: () => {
    if (arView.live) dismissStudioMessage();
    if (tryOn.enabled && !arView.enabled) endTryOn({ restoreView: false });
    cancelMouseStroke(); poseTarget = null; poseDisplayed = null; smoothedPoints = null;
    sceneHost.setAttribute('aria-label', arView.live ? 'Camera view with editable mask' : 'Three dimensional hand tracking view');
  },
  onError: () => setPrompt('Camera view could not start.', 'The studio is ready. Set up the camera again to show the camera behind your mask.', 'warning'),
});
arButton.addEventListener('pointerdown', event => event.stopPropagation());
arButton.addEventListener('click', async () => {
  if (tryOn.enabled) endTryOn({ restoreView: false });
  const action = ++arAction;
  cancelMouseStroke();
  const enabled = !arView.enabled;
  if (enabled) dismissStudioMessage();
  arView.setEnabled(enabled);
  if (!enabled) {
    if (arStartedCamera && cameraOpening) stopCamera();
    arStartedCamera = false;
    sceneHint.innerHTML = toolDetails().hint;
    return;
  }
  if (stream) await arView.attachStream(stream);
  else if (!cameraOpening) {
    arStartedCamera = true;
    cameraButton.hidden = false;
    document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
    await startCamera();
    if (action === arAction) arStartedCamera = false;
  }
  if (arView.live && !tryOn.enabled) sceneHint.textContent = 'AR mode on · point at the mask to shape or erase';
});
function dismissStudioMessage() {
  studioMessage.hidden = true;
  sceneHint.hidden = false;
}
studioMessageOK.addEventListener('pointerdown', event => event.stopPropagation());
const comfortSetup = new ComfortSetup({
  stage: sceneHost.parentElement,
  startCamera: async () => {
    if (!stream) await startCamera();
    else if (!landmarker) await startTracking();
  },
  onReady: (cursor = false) => { if (cursor) stopCamera(); sceneHint.hidden = false; studioTutorial.start(); },
});
video.addEventListener('resize', () => {
  if (arView.live) { cancelMouseStroke(); poseTarget = null; poseDisplayed = null; smoothedPoints = null; }
});

scene.add(new THREE.HemisphereLight('#fff9f2', '#c4a895', 2.2));
const keyLight = new THREE.DirectionalLight('#fffaf2', 2.8);
keyLight.position.set(-3, 4, 6);
scene.add(keyLight);
const warmLight = new THREE.PointLight('#de8d67', 22, 12);
warmLight.position.set(3, -2, 4);
scene.add(warmLight);

const clayObjects = new ClayObjects(scene);
const tryOn = new MaskTryOn(scene.children.filter(child => child.isLight));
const tryButton = document.querySelector('#try-toggle');
tryButton.addEventListener('pointerdown', event => event.stopPropagation());
tryButton.addEventListener('click', () => {if(tryOn.enabled)endTryOn();else startTryOn();});
async function startTryOn() {
  if(tryOn.enabled)return true;
  setResizeMode(false);
  if (clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending) {
    sceneHint.textContent = 'Finishing your mask · try it in a moment'; return;
  }
  tryPreviousAR = arView.enabled;
  tryStartedCamera = !stream && !cameraOpening;
  cancelMouseStroke(); trackingEpoch++;
  poseTarget = null; poseDisplayed = null; handModel.visible = false; clearPreview();
  tryOn.setEnabled(true);
  // Keep index selection available while face tracking loads and runs.
  scheduleHandTracking();
  tryPhase = null;
  const epoch = ++faceEpoch;
  faceAbort = new AbortController(); const signal = faceAbort.signal;
  document.querySelector('#stage').classList.add('is-trying');
  document.querySelector('#session-label').textContent = 'TRY IT';
  const handCheck = document.querySelector('#check-hand');
  tryHandWasDone = handCheck.classList.contains('is-done');
  handCheck.children[1].textContent = 'Show your face'; handCheck.classList.remove('is-done');
  tryButton.setAttribute('aria-pressed', 'true'); tryButton.classList.add('is-active');
  cameraButton.hidden = false; mouseButton.hidden = true;
  arView.setEnabled(true);
  try {
    if (stream) await arView.attachStream(stream); else await startCamera();
    if (epoch !== faceEpoch || !tryOn.enabled) return;
    if (!stream || !arView.live) throw new Error('Camera view is unavailable');
    const tracker = await TrackingClient.create('face', signal);
    if (epoch !== faceEpoch || !tryOn.enabled) { tracker.close(); return; }
    faceTracker = tracker; lastFaceVideoTime = -1; nextFaceTrackingAt = 0;
    if (!landmarker) {
      const hands = await createLandmarker();
      if (epoch !== faceEpoch || !tryOn.enabled) { hands.close(); return; }
      landmarker = hands;
    }
    cameraButton.disabled = false; buttonLabel.textContent = 'Camera on';
    faceTrackingLoop(epoch);
    return true;
  } catch (error) {
    if (epoch !== faceEpoch || !tryOn.enabled) return;
    console.warn('Mask try-on could not start:', error);
    endTryOn();
    setPrompt('Try it could not start.', 'Face tracking could not load. Check your connection and try again; your mask is ready to keep creating.', 'warning');
    return false;
  }
}

function endTryOn({ restoreView = true, resumeTracking = true } = {}) {
  if(selfie?.busy){selfie.close();return;}
  if (!tryOn.enabled) return;
  faceEpoch++; faceAbort?.abort(); faceTracker?.close(); faceTracker = null;
  cancelAnimationFrame(faceFrame); tryOn.setEnabled(false);
  trackingEpoch++;
  handUI?.reset(); handUICaptured = false;
  document.querySelector('#stage').classList.remove('is-trying');
  tryButton.setAttribute('aria-pressed', 'false'); tryButton.classList.remove('is-active');
  tryButton.querySelector('.try-state').textContent = 'Off';
  poseTarget = null; poseDisplayed = null; smoothedPoints = null; gapStartedAt = null;
  mouseButton.hidden = !stream || Boolean(landmarker);
  document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
  const handCheck = document.querySelector('#check-hand');
  handCheck.children[1].textContent = 'Show one hand'; handCheck.classList.toggle('is-done', tryHandWasDone);
  sceneHost.setAttribute('aria-label', arView.live ? 'Camera view with editable mask' : 'Three dimensional hand tracking view');
  resetToolControls();
  if (restoreView) arView.setEnabled(tryPreviousAR);
  if (tryStartedCamera && cameraOpening) { tryStartedCamera = false; stopCamera(); return; }
  tryStartedCamera = false;
  if (resumeTracking && stream) {
    if (landmarker) scheduleHandTracking(); else startTracking();
  }
}

async function faceTrackingLoop(epoch) {
  const tracker = faceTracker;
  if (!tryOn.enabled || !stream || !tracker || epoch !== faceEpoch) return;
  try {
    const now = performance.now();
    // Each model is single-flight on its own worker. Waiting for face results
    // here must not delay fresh hand measurements and reset UI dwell progress.
    if (now >= nextFaceTrackingAt && video.readyState >= 2 && video.currentTime !== lastFaceVideoTime) {
      lastFaceVideoTime = video.currentTime;
      nextFaceTrackingAt = now + Math.max(tracker.minInterval ?? 33, now - lastTryHandAt < 800 ? 100 : 33);
      const result = await tracker.detectForVideo(video, now);
      if (epoch !== faceEpoch || !tryOn.enabled || tracker !== faceTracker) return;
      diagnostics.faceInferenceMs = tracker.duration;
      diagnostics.faceResultAgeMs = performance.now() - now;
      if (performance.now() - now < 400) tryOn.receive(result, performance.now(), video.videoWidth, video.videoHeight);
    }
  } catch (error) {
    if (epoch !== faceEpoch || !tryOn.enabled) return;
    console.warn('Mask try-on tracking stopped:', error);
    endTryOn();
    setPrompt('Face tracking paused.', 'Your mask is safe. Turn Try it on again to reconnect.', 'warning'); return;
  }
  if (epoch === faceEpoch && tryOn.enabled) faceFrame = requestAnimationFrame(() => faceTrackingLoop(epoch));
}
let clay = clayObjects.active.group;
let clayVolume = clayObjects.active.volume;
let clayMenu;
let mouseSculptPoint = null;
const clayRaycaster = new THREE.Raycaster();

const pinchCue = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 20, 16),
  new THREE.MeshBasicMaterial({ color: '#f3be87', transparent: true, opacity: 0.82 })
);
pinchCue.visible = false;
scene.add(pinchCue);
const reachCalibration = new ReachCalibration(cancelMouseStroke);
const contactCue = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), new THREE.MeshBasicMaterial({ color: '#7cb58b', transparent: true, opacity: 0.85, depthTest: false }));
contactCue.visible = false;
contactCue.renderOrder = 5;
scene.add(contactCue);
const brushCue = new THREE.Mesh(
  new THREE.RingGeometry(.97, 1, 96),
  new THREE.MeshBasicMaterial({ color: '#286743', transparent: true, opacity: 1, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
);
brushCue.visible = false; brushCue.renderOrder = 6; scene.add(brushCue);
const grabTether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: '#538c68', depthTest: false, transparent: true, opacity: 0.8 }));
grabTether.visible = false; grabTether.renderOrder = 6; scene.add(grabTether);
const mirroredBrush = brushCue.clone();
mirroredBrush.material = brushCue.material.clone();
mirroredBrush.material.opacity = 0.55;
mirroredBrush.visible = false; scene.add(mirroredBrush);
const brushStatus = document.createElement('span');
brushStatus.className = 'brush-status'; brushStatus.hidden = true;
brushStatus.innerHTML = '<span class="studio-loading-icon" aria-hidden="true">Ⅱ</span>';
brushStatus.setAttribute('aria-label', 'Applying your changes');
brushStatus.setAttribute('role', 'status');
document.querySelector('#stage').append(brushStatus);
function isBrushApplying() {
  return brushApplying(clayVolume, activeTool, {
    radius: brushRadius(), eye: clay.worldToLocal(camera.position.clone()).toArray(), symmetry: symmetryEnabled,
  });
}
function showApplyingBrush(point) {
  const planeZ = clay.localToWorld(new THREE.Vector3(0, 0, .9)).z;
  clayRaycaster.set(camera.position, new THREE.Vector3(point.x, point.y, 0).sub(camera.position).normalize());
  const world = clayRaycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ), new THREE.Vector3());
  brushCue.visible = Boolean(world) && activeSize > 0;
  if (world) brushCue.position.copy(world);
  brushCue.scale.setScalar(brushRadius() * clay.scale.x);
  contactCue.visible = false; pinchCue.visible = false; grabTether.visible = false;
}
function updateBrushFeedback(now) {
  const applying = !tryOn.enabled && (isBrushApplying() || deformationApplying(clayVolume));
  const showLoading = applying && !resizeEnabled && !handUI?.isOpen && !editingPaused;
  handUI?.cursor.classList.toggle('is-applying', showLoading);
  brushCue.material.color.set('#286743');
  brushCue.material.opacity = showLoading ? 0 : 1;
  mirroredBrush.material.opacity = showLoading ? 0 : .55;
  if (showLoading) { contactCue.visible = false; pinchCue.visible = false; grabTether.visible = false; }
  // Hand input uses the cursor's exact position. Mouse input uses the brush
  // center as a fallback, without the old floating Applying label.
  brushStatus.hidden = !showLoading || !brushCue.visible || !handUI?.cursor.hidden;
  if (!brushStatus.hidden) {
    const point = brushCue.position.clone().project(camera);
    const canvas = renderer.domElement.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
    const x = canvas.left - stage.left + (point.x + 1) * canvas.width / 2;
    const y = canvas.top - stage.top + (1 - point.y) * canvas.height / 2;
    brushStatus.style.left = `${x}px`;
    brushStatus.style.top = `${y}px`;
  }
}
const symmetryGuide = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]),
  new THREE.LineDashedMaterial({ color: '#538c68', dashSize: 0.07, gapSize: 0.055, transparent: true, opacity: 0.4, depthTest: false }),
);
symmetryGuide.computeLineDistances(); symmetryGuide.visible = false; symmetryGuide.renderOrder = 5; scene.add(symmetryGuide);
const cutPreview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#c86348', depthTest: false }));
cutPreview.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2048 * 3), 3).setUsage(THREE.DynamicDrawUsage));
cutPreview.geometry.setDrawRange(0, 0); cutPreview.frustumCulled = false; cutPreview.renderOrder = 7; cutPreview.visible = false; scene.add(cutPreview);
const mirroredCutPreview = cutPreview.clone();
mirroredCutPreview.geometry = cutPreview.geometry.clone();
mirroredCutPreview.material = cutPreview.material.clone(); mirroredCutPreview.material.transparent = true; mirroredCutPreview.material.opacity = 0.6;
mirroredCutPreview.visible = false; scene.add(mirroredCutPreview);
const contactLabel = document.querySelector('#reach-contact');
const depthGuide = document.querySelector('#reach-depth');
const resizeCues = new THREE.Group(); resizeCues.visible = false; scene.add(resizeCues);
const resizeCueMaterial = new THREE.LineBasicMaterial({ color: '#538c68', depthTest: false });
const resizeCueGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, (_, i) =>
  new THREE.Vector3(Math.cos(i / 24 * Math.PI * 2) * 0.12, Math.sin(i / 24 * Math.PI * 2) * 0.12, 0)));
const resizeRings = [0, 1].map(() => {
  const ring = new THREE.LineLoop(resizeCueGeometry, resizeCueMaterial); ring.renderOrder = 7;
  resizeCues.add(ring); return ring;
});
const resizeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), resizeCueMaterial);
resizeLine.frustumCulled = false; resizeLine.renderOrder = 7; resizeCues.add(resizeLine);
const moveCue = new THREE.LineLoop(resizeCueGeometry, resizeCueMaterial.clone());
moveCue.renderOrder = 7; moveCue.visible = false; scene.add(moveCue);
document.querySelector('#restart-reach').addEventListener('click', () => { cancelMouseStroke(); reachCalibration.reset(); });

function finishMoveStroke(blockUntilOpen = false) {
  const block = blockUntilOpen && (palmMove.active || palmMove.candidateAt !== null || palmMove.needsOpen || palmGesture.blocked);
  palmGesture.reset(block || palmGesture.blocked);
  palmMove.reset(block); moveIntent = false; moveTarget = null; moveSaved = false; movePhase = null;
  moveCue.visible = false;
}

function showPalmMove(landmarks, now, aspect, screenSpace = false) {
  // Once a patch is held, relaxed outer fingers cannot steal the gesture.
  // A complete fist can still switch to whole-mask movement.
  if ((activeTool === 'pinch' || activeTool === 'extrude') && previousPullPoint && pinchGesture.held && !closedPalm(landmarks, aspect)) {
    moveIntent = false; return false;
  }
  const gesture = palmGesture.update(landmarks, now, aspect), held = gesture.held, wasMoving = palmMove.active;
  const offset = clayVolume.userOffset ?? [0, 0];
  moveIntent = gesture.blocksPinch;
  if (!moveIntent && !wasMoving) {
    palmMove.reset(); moveTarget = null; moveCue.visible = false;
    return false;
  }
  const palm = held ? palmCenter(landmarks) : null;
  const aim = palm && resizeScenePoint(palm, screenSpace);
  const available = !handUI?.isOpen && !editingPaused && !clayMenu?.isOpen && !clayVolume.meshFailed && !clayVolume.pulling
    && !clayVolume.cutting && !clayVolume.meshQueue?.pending;
  // Test the surface only when picking it up. Once held, the cursor may move
  // beyond the silhouette, without needing to find another piece of material.
  const hit = aim && !palmMove.active && !palmMove.needsOpen && available ? getClaySurfaceHit(aim) : null;
  if (hit) movePlane.constant = -hit.worldPoint.z;
  let cursor = null;
  if (aim) {
    clayRaycaster.set(camera.position, new THREE.Vector3(aim.x, aim.y, 0).sub(camera.position).normalize());
    cursor = clayRaycaster.ray.intersectPlane(movePlane, new THREE.Vector3());
  }
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.position.z - clay.position.z);
  const halfWidth = halfHeight * camera.aspect;
  const base = clayVolume.layoutPosition ?? [0, 0, 0];
  const bounds = { min: [-halfWidth + .15 - base[0], -halfHeight + .15 - base[1]],
    max: [halfWidth - .15 - base[0], halfHeight - .15 - base[1]] };
  const result = palmMove.update(cursor, held, now, offset, Boolean(hit), bounds);
  moveReceivedAt = now;
  moveTarget = result.phase === 'holding' ? result.offset : null;
  moveCue.visible = Boolean(cursor && (result.phase === 'ready' || result.phase === 'holding'));
  if (moveCue.visible) { moveCue.position.copy(cursor); moveCue.position.z += .035; }
  if (result.finished) moveSaved = false;
  // A fist cannot simultaneously reshape a patch or finish a cut outline.
  if (previousPullPoint) pullClayAlongPath(null, false);
  clayVolume.surfaceErase?.finish();
  cutStroke = null; cutPreview.visible = false; mirroredCutPreview.visible = false;
  pinchGesture.reset(); pinchActive = false; pinchHasContact = false; recentGrabHit = null;
  contactCue.visible = false; brushCue.visible = false; pinchCue.visible = false; grabTether.visible = false;
  lastPinchHint = true;
  const phase = gesture.released ? 'released' : gesture.opening ? 'opening' : result.phase;
  if (phase !== movePhase) {
    movePhase = phase;
    stageCaption.textContent = result.phase === 'holding' ? 'MASK HELD · MOVE YOUR HAND'
      : gesture.released ? 'POSITION KEPT · READY TO CREATE' : gesture.opening ? 'OPEN YOUR HAND · THEN PINCH TO CREATE' : 'CLOSED PALM · MOVE YOUR MASK';
    setPrompt(result.phase === 'holding' ? 'You’re holding the mask.' : gesture.released ? 'Position kept.' : gesture.opening ? 'Open your hand to switch back.' : 'Close your palm over the mask.',
      'A closed palm moves the mask. Fully open your hand to release, then pinch with your other fingers open to shape it.', 'success');
  }
  const contactHint = result.phase === 'holding' ? 'Mask held · open your palm to release'
    : gesture.released ? 'Ready to pinch' : gesture.opening ? 'Open your hand to sculpt' : 'Closed palm moves the mask';
  if (contactLabel.textContent !== contactHint) contactLabel.textContent = contactHint;
  const hint = result.phase === 'holding' ? 'Move your hand · open your palm to leave the mask here'
    : gesture.released ? 'Position kept · pinch to sculpt' : gesture.opening || palmMove.needsOpen ? 'Position kept · fully open your hand before the next pinch'
    : available ? 'Close your palm to move · fully open your hand before pinching' : 'Finishing your edit · hold your palm over the mask';
  if (sceneHint.textContent !== hint) sceneHint.textContent = hint;
  return true;
}

positionResetButton.addEventListener('pointerdown', event => event.stopPropagation());
positionResetButton.addEventListener('click', () => {
  if (positionResetButton.disabled) return;
  cancelMouseStroke(); checkpointPosition(clayVolume); applyMaskPosition(clayVolume, [0, 0]);
  clayObjects.updateMarker(); lastPinchHint = true;
  sceneHint.textContent = 'Position reset · keep creating';
  setPrompt('Position reset.', 'Your mask is back at its starting position. Its shape and size are kept.', 'success');
  updateHistoryButtons();
});

function updateResizeControl() {
  resizeButton.classList.toggle('is-active', resizeEnabled);
  resizeButton.querySelector('.resize-state').textContent = resizeEnabled ? 'On' : 'Off';
  resizeButton.title = resizeAutoPaused ? 'Two-hand tracking unavailable. Reconnect the camera to try again.'
    : 'Automatic: two hands resize; one hand moves, pinches or cuts';
  resizeButton.setAttribute('aria-label', `2-hand Resize: ${resizeEnabled ? 'On' : 'Off'}. Automatic.`);
  document.querySelector('#resize-help').textContent = resizeEnabled ? 'Close both palms · move apart or together'
    : resizeAutoPaused ? 'Auto resize paused · one-hand editing ready' : 'Automatic · show two hands to resize';
  document.querySelector('#stage').classList.toggle('is-resizing', resizeEnabled);
  document.querySelector('#check-hand').children[1].textContent = resizeEnabled ? 'Show both hands' : 'Show one hand';
}

function finishScaleStroke() {
  twoHandScale.reset(); resizeSaved = false; resizePhase = null;
  resizeTargetScale = null;
  resizeCues.visible = false;
}

function setResizeMode(enabled) {
  if ((enabled && (tryOn.enabled || resizeAutoPaused)) || enabled === resizeEnabled) return;
  // Finish the visible single-hand edit before switching. A surviving closed
  // hand must reopen before it can move, sculpt or cut after a two-hand hold.
  cancelMouseStroke(); resizeEnabled = enabled;
  palmGesture.reset(true); palmMove.reset(true);
  singleHandNeedsOpen = !enabled;
  poseTarget = null; poseDisplayed = null; smoothedPoints = null;
  handModel.visible = false; clearPreview(); updateResizeControl();
  if (enabled) {
    lastResizeHandAt = performance.now();
    tipHeading.textContent = 'Hold with two hands';
    tipCopy.textContent = 'Close both fists on opposite sides of the mask. Move apart or together to resize, then open either hand to keep the size.';
    stageCaption.textContent = 'TWO HANDS · HOLD TO RESIZE';
  } else {
    lastPinchHint = false;
    resetToolControls();
  }
  updateHistoryButtons();
}
resizeButton.addEventListener('pointerdown', event => event.stopPropagation());
updateResizeControl();

function processHandResult(result, now, sampleAt = now) {
  trackingTrace.record('tracking-result',{sampleAgeMs:now-sampleAt,hands:result.landmarks?.length??0,grabbing:Boolean(previousPullPoint),held:pinchActive,meshPending:Boolean(clayVolume.meshQueue?.pending)});
  const inputStream = stream;
  const wasTrying = tryOn.enabled;
  const editingMask = Boolean(previousPullPoint || cutStroke || palmMove.active || twoHandScale.active || pinchActive);
  const active = editingMask || moveIntent;
  const indices = (result.landmarks ?? []).map((hand, i) => palmCenter(hand) ? i : -1).filter(i => i >= 0).slice(0, 2);
  const hands = indices.map(i => result.landmarks[i]);
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
  if (comfortSetup.active) {
    if (hands[0]) drawPreviewSkeleton(hands[0]);
    else clearPreview();
    comfortSetup.observe(usableHandSample(sampleAt, now) ? hands : [], aspect, sampleAt);
    return;
  }
  const bothFists = hands.length === 2 && hands.every(hand => closedFist(hand, aspect));
  const resizeIntent = bothFists && !resizeAutoPaused && !handUI?.isOpen && !editingPaused;
  diagnostics.detectedHands = hands.length;
  diagnostics.resize = resizeAutoPaused ? 'unavailable' : hands.length < 2 ? 'need-two-hands' : bothFists ? 'fists-detected' : 'close-fists';
  // Curled outer fingers can accompany an extended pointing index. Reserve
  // the UI only for an actual edit; the UI itself rejects a closed palm.
  const ui = handUI?.receive(result, now, { blocked: editingMask && !tryOn.enabled, aspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1, sampleAt });
  // A hand-selected camera shutdown must not reclaim input for that last
  // tracking frame after stopCamera has handed editing back to the cursor.
  if (inputStream && stream !== inputStream) { handUICaptured = false; return; }
  // A hand-selected return changes modes inside receive(). Do not sculpt
  // with the same frame that just selected Back to creating.
  if (wasTrying || tryOn.enabled) return;
  // Stable camera/inference delay must not look like repeated hand loss.
  // Only new, usable measurements may edit; missing detections still pause.
  if (!usableHandSample(sampleAt, now)) { showNoHand(now,'stale-tracking-result'); return; }
  // A detector miss is not a release or a hand switch. Keep the existing
  // patch during the short tracking grace period and stop applying movement.
  if (active && !twoHandScale.active && !resizeIntent && ui?.index === null && !ui.owns && !handUI?.isOpen && !editingPaused) {
    showNoHand(now,'editing-hand-missing'); return;
  }
  // Do not transfer a held stroke to a surviving, different hand. Keep the
  // visible edit and wait for an open hand before accepting another gesture.
  const lostEditHand = active && !twoHandScale.active && !resizeIntent && (ui?.index === null || ui?.changed);
  if (ui?.changed) smoothedPoints = null;
  if (((ui?.owns || ui?.missing) && !resizeIntent) || lostEditHand || handUI?.isOpen || editingPaused || (handUICaptured && ui?.needsOpen && !resizeIntent)) {
    if(!handUICaptured && controlMode==='palm' && editingMask)trackingTrace.incident('ui-input-capture',{owns:ui?.owns,missing:ui?.missing,changed:ui?.changed,needsOpen:ui?.needsOpen,menuOpen:handUI?.isOpen,editingPaused,grabbing:Boolean(previousPullPoint),uiPalm:handUI?.palmInput?.diagnostic});
    if (!handUICaptured) cancelMouseStroke();
    setResizeMode(false);
    poseTarget = null; poseDisplayed = null; smoothedPoints = null;
    handModel.visible = false; brushCue.visible = false; mirroredBrush.visible = false;
    handUICaptured = true;
    return;
  }
  if (handUICaptured) {
    handUICaptured = false; cancelMouseStroke(); palmGesture.reset(true); singleHandNeedsOpen = true;
  }
  // Two complete fists explicitly switch intent. Finish the last measured edit
  // before resizing, rather than waiting for a pinch release hidden by a fist.
  const resizing = twoHandScale.active || bothFists;
  setResizeMode(resizing && !resizeAutoPaused);
  if (resizeEnabled) showResizeHands(hands, now);
  else if (hands.length) {
    const i = indices.includes(ui?.index) ? ui.index : indices[0];
    if (singleHandNeedsOpen) palmMove.reset(true);
    showTracking(result.landmarks[i], now, result.worldLandmarks?.[i], result.handedness?.[i]?.[0]?.categoryName ?? '', sampleAt);
    if (!palmGesture.blocked) singleHandNeedsOpen = false;
    if (hands.length === 2 && !previousPullPoint && !cutStroke && !pinchGesture.held && !palmMove.active) {
      landmarkCount.textContent = '42 LANDMARKS · 2 HANDS';
      setStatus('ready', 'BOTH HANDS DETECTED');
      sceneHint.textContent = 'Both hands detected · close both fists to resize';
      stageCaption.textContent = 'TWO HANDS · CLOSE BOTH FISTS TO RESIZE';
      diagnostics.resize = 'close-fists';
    }
  } else {
    landmarkCount.textContent = '0 LANDMARKS · WAITING';
    setStatus('searching', 'LOOKING FOR HAND');
    showNoHand(now,'no-hand-detected');
  }
}

function resizeScenePoint(point, screenSpace = false) {
  if (arView.live || screenSpace) {
    const p = arView.live ? cameraCoverPoint(point, video.videoWidth, video.videoHeight, sceneHost.clientWidth, sceneHost.clientHeight) : { x: 1 - point.x, y: point.y };
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    return new THREE.Vector3((p.x - 0.5) * height * camera.aspect, (0.5 - p.y) * height, 0.05);
  }
  return new THREE.Vector3((0.5 - point.x) * 4.8,
    (0.5 - point.y) * Math.min(4.8 * sceneHost.clientHeight / sceneHost.clientWidth, 3.5), 0.05);
}

function showResizeHands(hands, now) {
  if (!resizeEnabled || tryOn.enabled) return;
  lastResizeHandAt = now;
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
  const palms = hands.slice(0, 2).map(palmCenter);
  const points = palms.map(p => p && resizeScenePoint(p, true));
  // Grips can sit comfortably beside a small mask, especially in a wide AR
  // view. Requiring proximity to its surface made valid two-hand holds fail.
  const oppositeSides = points.length === 2 && points.every(Boolean)
    && Math.min(points[0].x, points[1].x) < clay.position.x
    && Math.max(points[0].x, points[1].x) > clay.position.x;
  const savingEdit = Boolean(clayVolume.meshQueue?.pending || clayVolume.pulling || clayVolume.cutting || clayVolume.erasing);
  const canStart = oppositeSides && !savingEdit && !clayMenu?.isOpen;
  const result = twoHandScale.update(hands, now, clayVolume.userScale ?? 1, aspect, canStart);
  resizeTargetScale = result.phase === 'holding' ? result.scale : null;
  if (result.finished) resizeSaved = false;
  resizeCues.visible = points.length === 2 && points.every(Boolean);
  if (resizeCues.visible) {
    points.forEach((p, i) => resizeRings[i].position.copy(p));
    resizeCueMaterial.color.set(result.phase === 'holding' || result.phase === 'ready' ? '#538c68' : '#be914b');
    const line = resizeLine.geometry.attributes.position;
    points.forEach((p, i) => line.setXYZ(i, p.x, p.y, p.z)); line.needsUpdate = true;
  }
  landmarkCount.textContent = `${hands.length * 21} LANDMARKS · ${hands.length} HAND${hands.length === 1 ? '' : 'S'}`;
  document.querySelector('#check-hand').classList.add('is-done');
  setStatus(hands.length === 2 ? 'ready' : 'searching', hands.length === 2 ? 'BOTH HANDS DETECTED' : 'SHOW BOTH HANDS');
  clearPreview(); hands.slice(0, 2).forEach(p => drawPreviewSkeleton(p, false));
  const phase = result.phase === 'waiting' && resizePhase === 'released' ? 'released' : result.phase;
  diagnostics.resize = phase === 'holding' ? 'holding' : !oppositeSides ? 'opposite-sides' : savingEdit ? 'saving-edit' : phase;
  if (phase !== resizePhase) {
    resizePhase = phase;
    stageCaption.textContent = phase === 'holding' ? 'MASK HELD · MOVE YOUR HANDS APART OR TOGETHER' : 'TWO HANDS · HOLD TO RESIZE';
  }
  const title = phase === 'holding' ? 'You’re holding the mask.' : phase === 'released' ? 'Size kept.'
    : hands.length < 2 ? 'Show both hands.' : !oppositeSides ? 'One hand on each side.'
    : savingEdit ? 'Keeping your deformation.'
    : phase === 'ready' ? 'Both grips detected.' : 'Close both fists.';
  const body = phase === 'holding' ? 'Move your hands apart to enlarge, together to shrink. Open either hand to release.'
    : phase === 'released' ? 'Your mask stays this size. Close both fists again to resize.'
    : hands.length < 2 ? 'Keep both hands and wrists in the camera view.'
    : !oppositeSides ? 'Place one hand to the left of the mask and the other to the right. You can leave a comfortable gap.'
    : savingEdit ? 'Keep both fists closed. Resizing starts as soon as your last edit is saved.'
    : phase === 'ready' ? 'Hold briefly, then move apart or together. Open either hand to release.'
    : 'Close both hands to grip. Your hands can stay beside the mask; they do not need to touch its edges.';
  if (promptTitle.textContent !== title || promptBody.textContent !== body) setPrompt(title, body, 'success');
  const hint = phase === 'holding' ? `${Math.round(result.scale * 100)}% · move apart or together · open either hand to release`
    : phase === 'released' ? 'Released · your mask stays this size' : hands.length < 2 ? 'Show both hands in the camera'
    : !oppositeSides ? 'One hand on each side of the mask' : savingEdit ? 'Keeping your edit · keep both fists closed to resize'
    : phase === 'ready' ? 'Both grips detected · hold briefly' : 'Close both fists to grip';
  if (sceneHint.textContent !== hint) sceneHint.textContent = hint;
}

function resetClay() {
  if (tryOn.enabled) return;
  const cancelErase = !redo && clayVolume.erasing && clayVolume.surfaceErase?.active;
  if (!cancelErase && (clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending)) return;
  if(cancelErase) singleHandNeedsOpen = true;
  cancelMouseStroke();
  checkpoint(clayVolume);
  applyMaskScale(clayVolume, 1);
  clayVolume.reset();
  clayObjects.active.edited = false;
  pinchActive = false;
  pinchHasContact = false;
  mousePinching = false;
  previousPullPoint = null;
  pinchCue.visible = false;
  resetButton.hidden = true;
  lastPinchHint = false;
  resetToolControls();
  setPrompt('Fresh mask, ready to shape.', cursorInputEnabled() ? toolDetails().mouseHint : toolDetails().body, 'success');
}

function selectClayObject(id) {
  cancelMouseStroke();
  const item = clayObjects.select(id);
  clay = item.group;
  clayVolume = item.volume;
  resetButton.hidden = !item.edited;
  resetButton.title = `Reset ${item.label}`;
  clayMenu?.refresh();
  resetToolControls();
}

function markClayEdited() {
  clayObjects.active.edited = true;
  resetButton.hidden = false;
}

const fingerChains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const handModel = new THREE.Group();
handModel.position.z = 1.3;
const handSkin = new THREE.MeshStandardMaterial({ color: '#d9a17f', roughness: 0.72, transparent: true, opacity: 0.5, depthWrite: false });
const palmSkin = new THREE.MeshStandardMaterial({ color: '#e1b08f', roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false });
const handBoneGeometry = new THREE.CylinderGeometry(1, 0.94, 1, 12, 1);
const handJointGeometry = new THREE.SphereGeometry(1, 14, 10);
const handBones = [];
const handJoints = [];
const handSegments = [];

fingerChains.forEach((chain, fingerIndex) => {
  chain.slice(0, -1).forEach((start, segmentIndex) => {
    const end = chain[segmentIndex + 1];
    const bone = new THREE.Mesh(handBoneGeometry, handSkin);
    handModel.add(bone);
    handBones.push({ mesh: bone, start, end, fingerIndex, segmentIndex });
    handSegments.push([start, end, fingerIndex, segmentIndex]);
  });
});

for (let index = 0; index < 21; index += 1) {
  const joint = new THREE.Mesh(handJointGeometry, handSkin);
  handModel.add(joint);
  handJoints.push(joint);
}

const palmPerimeter = [0, 1, 5, 9, 13, 17];
const palmGeometry = new THREE.BufferGeometry();
palmGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
const palmIndices = [];
for (let index = 0; index < palmPerimeter.length; index += 1) {
  palmIndices.push(0, index + 1, ((index + 1) % palmPerimeter.length) + 1);
}
palmGeometry.setIndex(palmIndices);
const palmSurface = new THREE.Mesh(palmGeometry, palmSkin);
handModel.add(palmSurface);
handModel.visible = false;
scene.add(handModel);

const boneAxis = new THREE.Vector3(0, 1, 0);
function updateHandSurface(mappedPoints) {
  const handPoints = mappedPoints.map(({ x, y, z }) => new THREE.Vector3(x, y, z));
  // Keep hand thickness proportional to the tracked palm as its apparent size changes in frame.
  const palmWidth = Math.max(0.25, handPoints[5].distanceTo(handPoints[17]));
  for (const { mesh, start, end, fingerIndex, segmentIndex } of handBones) {
    const from = handPoints[start];
    const to = handPoints[end];
    const direction = to.clone().sub(from);
    const radiusScale = fingerIndex === 0 ? 0.105 : 0.082;
    const segmentScale = segmentIndex === 0 ? 1.2 : segmentIndex === 2 ? 0.82 : 1;
    const radius = palmWidth * radiusScale * segmentScale;
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(boneAxis, direction.clone().normalize());
    mesh.scale.set(radius, Math.max(0.04, direction.length()), radius);
  }
  handJoints.forEach((joint, index) => {
    const baseRadius = index === 0 ? 0.12 : palmWidth * (index === 4 || index === 8 || index === 12 || index === 16 || index === 20 ? 0.095 : 0.105);
    joint.position.copy(handPoints[index]);
    joint.scale.setScalar(baseRadius);
  });
  const palmPositions = palmGeometry.attributes.position;
  const center = new THREE.Vector3();
  palmPerimeter.forEach((landmarkIndex) => center.add(handPoints[landmarkIndex]));
  center.multiplyScalar(1 / palmPerimeter.length);
  palmPositions.setXYZ(0, center.x, center.y, center.z);
  palmPerimeter.forEach((landmarkIndex, index) => {
    const point = handPoints[landmarkIndex];
    palmPositions.setXYZ(index + 1, point.x, point.y, point.z);
  });
  palmPositions.needsUpdate = true;
  palmGeometry.computeVertexNormals();
  handModel.visible = true;
}

function getClaySurfaceHit(handPoint, surface = clay) {
  const target = new THREE.Vector3(handPoint.x, handPoint.y, 0);
  const direction = target.sub(camera.position).normalize();
  clayRaycaster.set(camera.position, direction);
  surface.updateMatrixWorld(true);
  const hit = clayRaycaster.intersectObject(surface, true)[0];
  if (!hit) return null;
  clayVolume.meshQueue?.prioritize?.(hit.object.name.replace('ClayBrick_',''));
  const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 0, 1);
  return {
    point: clay.worldToLocal(hit.point.clone()),
    worldPoint: hit.point.clone(),
    worldNormal: normal,
  };
}

function getClaySurfacePoint(handPoint) {
  return getClaySurfaceHit(handPoint)?.point ?? null;
}

function pullClayAlongPath(handPoint, isPulling, surfacePoint = undefined) {
  if (!isPulling || !handPoint) {
    clayVolume.surfacePull?.finish();
    grabTether.visible = false;
    previousPullPoint = null;
    previousPullCursorPoint = null;
    grabCursorOrigin = null; grabAnchor = null;
    return;
  }
  if (!previousPullPoint) {
    const currentPoint = surfacePoint === undefined ? getClaySurfacePoint(handPoint) : surfacePoint;
    if (!currentPoint) return;
    if (clayVolume.pulling || clayVolume.meshQueue?.pending || activeStrength === 0 || activeSize === 0) return;
    const volume = clayVolume;
    const item = clayObjects.active;
    volume.surfacePull ??= new SurfacePull(volume, () => {
      item.edited = true;
      if (volume === clayVolume) markClayEdited();
      const warp = volume.surfacePull.lastWarp;
      queueMicrotask(() => { if (volume === clayVolume) studioTutorial?.recordPull(warp); });
    });
    // Save one reversible action, then deform the same original patch on every
    // update. No resampling or old path backlog runs in the drawing loop.
    const pullSetupAt=performance.now();
    trackingTrace.record('pull-begin-start');
    checkpoint(volume);
    const checkpointMs=performance.now()-pullSetupAt;
    const started=volume.surfacePull.begin(currentPoint, brushRadius(), activeStrength / 100, symmetryEnabled);
    trackingTrace.record('pull-begin-finish',{started,checkpointMs,setupMs:performance.now()-pullSetupAt});
    if (!started) return;
    previousPullPoint = currentPoint;
    grabAnchor = currentPoint.clone();
    pullPlane.constant = -clay.localToWorld(currentPoint.clone()).z;
    clayRaycaster.set(camera.position, new THREE.Vector3(handPoint.x, handPoint.y, 0).sub(camera.position).normalize());
    const cursor = clayRaycaster.ray.intersectPlane(pullPlane, new THREE.Vector3());
    grabCursorOrigin = cursor ? clay.worldToLocal(cursor) : currentPoint.clone();
    return;
  }
  // Hold the original grab plane after contact, including beyond the silhouette.
  clayRaycaster.set(camera.position, new THREE.Vector3(handPoint.x, handPoint.y, 0).sub(camera.position).normalize());
  const cursor = clayRaycaster.ray.intersectPlane(pullPlane, new THREE.Vector3());
  if (!cursor) return;
  clay.worldToLocal(cursor);
  grabCursorOrigin ??= cursor.clone().sub(previousPullPoint.clone().sub(grabAnchor));
  if (previousPullCursorPoint && cursor.distanceToSquared(previousPullCursorPoint) < 1e-12) return;
  const appliedPoint = clayVolume.surfacePull.update(cursor.clone().sub(grabCursorOrigin));
  if (appliedPoint) previousPullPoint = appliedPoint;
  previousPullCursorPoint = cursor;
  const tether = grabTether.geometry.attributes.position;
  const start = clay.localToWorld(grabAnchor.clone()), end = clay.localToWorld(previousPullPoint.clone());
  tether.setXYZ(0, start.x, start.y, start.z + 0.025);
  tether.setXYZ(1, end.x, end.y, end.z + 0.025); tether.needsUpdate = true;
  grabTether.geometry.boundingSphere = null; grabTether.visible = true;
}

function resizeScene() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.position.z = width < 540 ? 10 : 8.6;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  tryOn.resize(width, height);
  cancelMouseStroke();
  if (arView.live) { poseTarget = null; poseDisplayed = null; smoothedPoints = null; }
  clayObjects.layout(camera);
}
new ResizeObserver(resizeScene).observe(sceneHost);

function updateSculptSound() {
  const held = mousePinching || (pinchGesture.held && performance.now() - lastHandAt < 250);
  if (!held || document.hidden || handUICaptured || editingPaused || tryOn.enabled) { sculptSounds.stop(); return; }
  let point, amount = 0;
  if (activeTool === 'pinch' && previousPullPoint) {
    point = previousPullPoint.toArray(); amount = grabAnchor ? previousPullPoint.distanceTo(grabAnchor) : 0;
  } else if (activeTool === 'extrude' && clayVolume.surfaceExtrude?.active) {
    const points = clayVolume.surfaceExtrude.points;
    point = points.at(-1)?.toArray(); amount = point ? points.at(-1).distanceTo(points[0]) : 0;
  } else if (activeTool === 'erase' && clayVolume.surfaceErase?.active && !clayVolume.surfaceErase.released) {
    point = clayVolume.surfaceErase.lastPoint;
  } else if (activeTool === 'paint' && clayVolume.surfacePaint?.active) {
    point = clayVolume.surfacePaint.last?.toArray();
  } else if (activeTool === 'cut' && cutStroke) point = cutStroke.points.at(-1);
  sculptSounds.update(activeTool, point, amount);
}

function renderScene() {
  studioTutorial?.update({ held: pinchActive || mousePinching, contact: Boolean(previousPullPoint || clayVolume.surfacePaint?.active || contactCue.visible),
    tracked: performance.now() - lastHandAt < 600, mouse: cursorInputEnabled(), busy: clayVolume.pulling || clayVolume.meshQueue?.pending, tool: activeTool });
  updateSculptSound();
  for(const item of clayObjects.items)item.volume.surfacePaint?.tick();
  studioBackdrop.update(clayObjects.active.material.color);
  arView.update();
  const now = performance.now();
  studioBackdrop.present(clayObjects.active.group,{visible:!arView.live && !tryOn.enabled,painting:activeTool==='paint'});
  diagnostics.poseAgeMs = poseTarget ? now - poseSampleAt : 0;
  diagnostics.pointerAgeMs = handUI?.motion.time != null ? Math.max(0, now - handUI.motion.time) : 0;
  const dt = Math.min(0.05, (now - previousRenderAt) / 1000);
  diagnostics.frameMs = now - previousRenderAt;
  previousRenderAt = now;
  if (palmMove.active && now - moveReceivedAt >= 200) {
    finishMoveStroke(); sceneHint.textContent = 'Movement paused · bring your hand back';
  }
  if (palmMove.active && moveTarget) {
    const current = clayVolume.userOffset ?? [0, 0], blend = 1 - Math.exp(-dt / .02);
    const offset = current.map((v, i) => THREE.MathUtils.lerp(v, moveTarget[i], blend));
    if (Math.hypot(offset[0] - current[0], offset[1] - current[1]) > .0001) {
      if (!moveSaved) { checkpointPosition(clayVolume); moveSaved = true; }
      applyMaskPosition(clayVolume, offset); clayObjects.updateMarker();
    }
  }
  if (resizeEnabled && now - lastResizeHandAt >= Math.max(250, (landmarker?.minInterval ?? 50) + 100)) {
    setResizeMode(false);
    sceneHint.textContent = 'Resize paused · bring both hands back';
  }
  if (resizeEnabled && twoHandScale.active && resizeTargetScale !== null) {
    const currentScale = clayVolume.userScale ?? 1;
    const scale = THREE.MathUtils.lerp(currentScale, resizeTargetScale, 1 - Math.exp(-dt / 0.035));
    if (Math.abs(scale - currentScale) > 0.0001) {
      if (!resizeSaved) { checkpointScale(clayVolume); resizeSaved = true; markClayEdited(); }
      applyMaskScale(clayVolume, scale); clayObjects.updateMarker();
    }
  }
  if (!resizeEnabled && !tryOn.enabled && poseTarget && gapStartedAt === null && currentHandPose(handMotion.receivedAt, now)) {
    const visualPoints = handMotion.sample(now);
    poseDisplayed = mapHandPoints(visualPoints, poseScreenSpace);
    const handSurfacePoints = [...poseDisplayed];
    if(controlMode==='palm' && palmControlState?.point) {
      const cursor=mapHandPoints([palmControlState.point],poseScreenSpace)[0];
      poseDisplayed[8]=cursor;poseDisplayed[4]=cursor.clone();
    }
    // Prediction only affects visual feedback and hovering. Held strokes use
    // the measured filtered pose, so extrapolation cannot cut or erase clay.
    processHandPose(poseDisplayed, pinchGesture.held, pinchGesture.held ? poseTarget : poseDisplayed, handSurfacePoints);
    drawPreviewSkeleton(visualPoints);
    diagnostics.predictionMs = Math.min(Math.max(0, now - handMotion.receivedAt), handMotion.period, handMotion.maxPredictionMs);
  } else if (!resizeEnabled && !tryOn.enabled && poseTarget && !currentHandPose(handMotion.receivedAt, now)) {
    pauseTracking(now,'no-fresh-pose-for-300ms');
  }
  depthGuide.hidden = true;
  for (const item of clayObjects.items) {
    item.volume.pullPreview?.tick(now);
  }
  symmetryGuide.visible = symmetryEnabled && !tryOn.enabled;
  if (symmetryEnabled) {
    const radius = { full: 1.4, half: 0.75, animal: 1.8 }[clayVolume.shape];
    symmetryGuide.position.copy(clay.localToWorld(new THREE.Vector3(0, 0, 0.9)));
    symmetryGuide.scale.setScalar(radius * clay.scale.x);
  }
  updateBrushFeedback(now);
  mirroredBrush.visible = ['pinch', 'extrude', 'erase', 'paint'].includes(activeTool) && symmetryEnabled && brushCue.visible;
  if (mirroredBrush.visible) {
    const point = previousPullPoint?.clone() ?? clay.worldToLocal(brushCue.position.clone());
    point.x = -point.x;
    mirroredBrush.position.copy(clay.localToWorld(point)); mirroredBrush.position.z += 0.035;
    mirroredBrush.scale.copy(brushCue.scale);
    mirroredBrush.material.color.copy(brushCue.material.color);
  }
  if (arView.live) handModel.visible = false;
  const renderStarted=performance.now();
  if (tryOn.enabled) {
    tryOn.setItem(clayObjects.active);
    const wearing = tryOn.update(now, dt);
    const ready = Boolean(faceTracker);
    const phase = wearing ? 'wearing' : ready ? 'looking' : 'loading';
    if (tryPhase !== phase) {
      tryPhase = phase;
      tryButton.querySelector('.try-state').textContent = ready ? 'On' : 'Starting…';
      setStatus(wearing ? 'ready' : ready ? 'searching' : 'loading', wearing ? 'MASK ON' : ready ? 'LOOKING FOR FACE' : 'SETTING UP TRY IT');
      stageCaption.textContent = wearing ? 'LOOKING GOOD · YOUR MASK IS ON' : ready ? 'BRING YOUR FACE INTO VIEW' : 'OPENING YOUR FITTING ROOM';
      sceneHint.textContent = wearing ? 'Move your head · switch masks in Masks & color · turn Try it off to sculpt' : ready ? 'Face the camera · your mask will fit automatically' : 'Getting your mask ready to wear…';
      setPrompt(wearing ? 'That’s your creation!' : ready ? 'Let’s see your face.' : 'Getting ready to try it…',
        wearing ? 'Move your head and try a new color or another mask. Turn Try it off whenever you want to keep shaping.' : ready ? 'Look toward the camera in good light. Your selected mask will follow your face.' : 'Opening the camera and loading face tracking. The first try can take a few seconds.', wearing ? 'success' : 'neutral');
      tipHeading.textContent = wearing ? 'Made by you. Worn by you.' : 'Face the camera';
      tipCopy.textContent = 'Try different masks and colors. Turn Try it off to return to sculpting.';
      landmarkCount.textContent = wearing ? 'FACE TRACKED · MASK ON' : 'FACE TRACKING · WAITING';
      document.querySelector('#check-hand').classList.toggle('is-done', wearing);
      sceneHost.setAttribute('aria-label', 'Camera view wearing your selected mask');
    }
    renderer.render(tryOn.scene, tryOn.camera);
  } else renderer.render(scene, camera);
  const renderMs=performance.now()-renderStarted;
  if(renderMs>50)trackingTrace.record('slow-render',{renderMs,grabbing:Boolean(previousPullPoint),meshPending:Boolean(clayVolume.meshQueue?.pending)});
  selfie?.tick(now,{ready:!document.hidden && tryOn.enabled && tryOn.mask.visible && Boolean(tryOn.target) && arView.live && now-tryOn.receivedAt<300,video:arView.video,canvas:renderer.domElement});
  updateHistoryButtons();
  handUI?.tick(now);
  if(controlMode==='palm' && stream && !tryOn.enabled && !resizeEnabled) {
    sceneHint.textContent=palmInstruction(sceneHint.textContent);
    stageCaption.textContent=palmInstruction(stageCaption.textContent);
  }
  paintPicker.setControlMode(controlMode);
  document.querySelector('#tool-paint').style.setProperty('--active-paint',paintColor);
  paintPalette.hidden=activeTool!=='paint' || tryOn.enabled || Boolean(handUI?.isOpen);
  const building=Boolean(clayVolume.meshQueue?.pending || (clayVolume.pulling && clayVolume.surfacePull?.released) || (clayVolume.cutting && clayVolume.surfaceErase?.released));
  const refining=Boolean(clayVolume.meshQueue?.refining);
  surfaceStatus.hidden=!building && !refining;
  const canContinue=(activeTool==='erase' && clayVolume.surfaceErase?.active)
    || (activeTool==='extrude' && clayVolume.surfaceExtrude?.committing && clayVolume.surfaceExtrude.queue.length<4);
  const surfaceText=building ? (canContinue ? 'Keep creating · saving strokes in the background' : 'Keeping your change · choose your next tool or brush size') : 'Ready to create · surface cleanup in background';
  if(surfaceStatus.textContent!==surfaceText)surfaceStatus.textContent=surfaceText;
  surfaceStatus.dataset.phase=building ? 'building' : 'refining';
  studioFeedback.update({cameraOn:Boolean(stream),tracked:now-lastHandAt<600,held:pinchActive||mousePinching,paused:editingPaused,trying:tryOn.enabled,palm:controlMode==='palm',tool:activeTool,
    applying:deformationApplying(clayVolume) || isBrushApplying(),waiting:isBrushApplying()});
  animationFrame = requestAnimationFrame(renderScene);
}
renderScene();

function setStatus(state, label) {
  if (statusPill.dataset.state === state && trackingText.textContent === label) return;
  statusPill.dataset.state = state;
  trackingText.textContent = label;
}

function setPrompt(title, body, tone = 'neutral') {
  if(controlMode==='palm' && stream){title=palmInstruction(title);body=palmInstruction(body);}
  if (promptTitle.textContent !== title) promptTitle.textContent = title;
  if (promptBody.textContent !== body) promptBody.textContent = body;
  if (promptCard.dataset.tone !== tone) promptCard.dataset.tone = tone;
}

const pinchDetails = {
    context: 'Patch softness',
    caption: 'PULL · PINCH TO SHAPE',
    hint: '<span class="hint-icon">✦</span> Point at the mask · pinch · drag · release',
    mouseHint: 'Click a highlighted patch and drag; release to keep it',
    mouseCaption: 'PULL · CLICK AND DRAG',
    title: 'Point, pinch, and drag.',
    body: 'Aim at the mask until the green ring appears. Pinch and drag to shape it; release to keep it. Close your palm over the mask to move it; open to leave it there.',
    tipHeading: 'Pinch to shape',
    tipCopy: 'Closed palm moves. Open your hand, then pinch with the other fingers open to shape. Show both hands to resize automatically.',
};

const cutDetails = {
  context: 'Fixed fine cut', caption: 'CUT · PINCH, TRACE, RELEASE',
  hint: '<span class="hint-icon">✦</span> Pinch · trace edge to edge or a loop · release',
  mouseHint: 'Click and trace edge to edge or a closed loop; release to cut',
  mouseCaption: 'CUT · CLICK, TRACE, RELEASE', title: 'Trace a cut.',
  body: 'Pinch to start. Trace with your index from one edge to another, or draw a closed loop. Release: the smaller piece disappears. Undo brings it back.',
  tipHeading: 'Cut with your index', tipCopy: 'Trace edge to edge or a loop, then release. A closed palm moves. Show both hands to resize automatically.',
};
const eraseDetails = {
  context: 'Erase inside the circle', caption: 'ERASE · PINCH AND BRUSH',
  hint: '<span class="hint-icon">✦</span> Pinch · brush away the mask · release to stop',
  mouseHint: 'Hold the mouse button and brush over the mask to erase',
  mouseCaption: 'ERASE · CLICK AND BRUSH', title: 'Pinch to erase.',
  body: 'Pinch to activate the circle. Move it across the mask to erase the surface inside it. Open your fingers to stop. Undo brings it back.',
  tipHeading: 'Erase with a pinch', tipCopy: 'Pinch and move the circle to erase. Open your fingers to stop. A closed palm moves the mask; both fists resize it.',
};
const extrudeDetails = {
  context:'Extrusion base', caption:'EXTRUDE · PINCH, TRACE, RELEASE',
  hint:'Pinch a patch · trace a curve · release to taper the tip',
  mouseHint:'Click a patch and trace a curve; release to finish a narrow tip',
  mouseCaption:'EXTRUDE · CLICK AND TRACE', title:'Grow a tapered form.',
  body:'Pinch on the mask, move along a curve, then release. The extrusion grows from a wide base to a narrow tip. Size controls the base width.',
  tipHeading:'Trace to extrude', tipCopy:'Start on solid clay. Keep pinching while you trace, then open your fingers to finish. Undo removes the stroke.',
};
const paintDetails={context:'Brush softness',caption:'PAINT · PINCH AND TRACE',mouseCaption:'PAINT · CLICK AND TRACE',
  hint:'Pinch on the mask · follow your curve · release to finish',mouseHint:'Click and brush over the mask to paint',
  title:'Give your mask some color.',body:'Choose a color, pinch on the surface, and trace your design. Release to finish the stroke. Undo brings back the previous colors.',
  tipHeading:'Paint your character',tipCopy:'Use Size for the brush width. Choose another color for your next stroke. Symmetry paints both sides.'};
function baseToolDetails() { return activeTool === 'paint' ? paintDetails : activeTool === 'extrude' ? extrudeDetails : activeTool === 'erase' ? eraseDetails : activeTool === 'cut' ? cutDetails : pinchDetails; }

function toolDetails() {
  const details=baseToolDetails();
  if(controlMode!=='palm')return details;
  return Object.fromEntries(Object.entries(details).map(([key,value])=>[key,key.startsWith('mouse') ? value : palmInstruction(value)]));
}

function palmInstruction(text) {
  return text.replace(/keep your fingers pinched/gi,'keep your hand closed').replace(/pinching/gi,'holding your hand closed').replace(/pinched/gi,'closed').replace(/pinch/gi,'close your hand').replace(/your index(?: finger)?/gi,'your palm').replace(/open your fingers/gi,'open your hand');
}

function cursorInputEnabled() { return !comfortSetup.active && !stream && !cameraOpening && !tryOn.enabled; }

function showToolInstructions() {
  const details = toolDetails();
  const cursor = cursorInputEnabled();
  stageCaption.textContent = cursor ? details.mouseCaption : details.caption;
  sceneHint.innerHTML = cursor ? `<span class="hint-icon">✦</span> ${details.mouseHint}` : details.hint;
  setPrompt(cursor ? 'Create with your cursor.' : details.title,
    cursor ? `${details.mouseHint}. Undo brings back your last change.` : details.body, 'success');
  tipHeading.textContent = cursor ? 'Camera optional' : details.tipHeading;
  tipCopy.textContent = cursor ? 'Pull: click and drag. Extrude: trace a tapered form. Erase: hold and brush. Set up your camera to use your hands.' : details.tipCopy;
}

function updateStrengthControl() {
  const details = toolDetails();
  strengthValue.value = String(activeStrength);
  strengthValue.textContent = String(activeStrength);
  strengthContext.textContent = details.context;
  strengthInput.setAttribute('aria-valuetext', `${activeStrength} percent ${details.context.toLowerCase()}`);
}

strengthInput.addEventListener('input', () => {
  activeStrength = Number(strengthInput.value);
  updateStrengthControl();
});
updateStrengthControl();

function updateSizeControl() {
  sizeValue.value = `${activeSize}%`;
  sizeValue.textContent = `${activeSize}%`;
  sizeInput.setAttribute('aria-valuetext', `${activeSize} percent of the starting shape width`);
}

function updateHistoryButtons() {
  const waiting = Boolean(twoHandScale.active || palmMove.active || tryOn.enabled || clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending);
  const canCancelErase = clayVolume.erasing && clayVolume.surfaceErase?.active && !tryOn.enabled && !twoHandScale.active && !palmMove.active;
  undoButton.disabled = !canCancelErase && (waiting || !clayVolume.undoStack?.length);
  redoButton.disabled = waiting || !clayVolume.redoStack?.length;
  resetButton.disabled = waiting;
  positionResetButton.disabled = waiting || Math.hypot(...(clayVolume.userOffset ?? [0, 0])) < .0001;
  sizeInput.disabled=tryOn.enabled || resizeEnabled || activeTool === 'cut';
}

function useHistory(redo = false) {
  if (tryOn.enabled) return;
  const cancelErase = !redo && clayVolume.erasing && clayVolume.surfaceErase?.active;
  if (!cancelErase && (clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending)) return;
  if(cancelErase) singleHandNeedsOpen = true;
  cancelMouseStroke();
  const positionOnly = (redo ? clayVolume.redoStack : clayVolume.undoStack)?.at(-1)?.positionOnly;
  if (!restoreHistory(clayVolume, redo)) return;
  clayObjects.updateMarker();
  if (!positionOnly) markClayEdited();
  sceneHint.textContent = redo ? 'Change restored · keep creating' : 'Change undone · try another idea';
  setPrompt(redo ? 'Redone.' : 'Undone.', 'Point at a patch and try a new shape.', 'success');
  updateHistoryButtons();
}
undoButton.addEventListener('click', () => useHistory());
redoButton.addEventListener('click', () => useHistory(true));
document.addEventListener('sculpt-history-change', updateHistoryButtons);
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
    event.preventDefault(); useHistory(event.shiftKey || event.key.toLowerCase() === 'y');
  }
});
sizeInput.addEventListener('input', () => {
  activeSize = THREE.MathUtils.clamp(Number(sizeInput.value), 0, 90);
  // Begin a fresh stroke when the brush footprint changes.
  cancelMouseStroke();
  updateSizeControl();
});
updateSizeControl();

function resetToolControls() {
  clayVolume.surfacePaint?.finish();
  clayVolume.surfaceExtrude?.finish();
  tryPhase = null;
  cutStroke = null; cutPreview.visible = false; mirroredCutPreview.visible = false;
  clayVolume.surfacePull?.finish();
  clayVolume.surfaceErase?.finish();
  brushCue.visible = false; grabTether.visible = false;
  grabCursorOrigin = null; grabAnchor = null;
  pinchGesture.reset();
  strengthInput.disabled = tryOn.enabled || activeTool !== 'pinch'; sizeInput.disabled = tryOn.enabled || activeTool === 'cut';
  document.querySelector('#size-context').textContent = activeTool === 'paint' ? 'Paint brush width' : activeTool === 'erase' ? 'Erase circle width' : activeTool === 'extrude' ? 'Extrusion base width' : activeTool === 'cut' ? 'Cut follows your index' : 'Pull brush width';
  toolButtons.forEach(button => {
    const selected = button.dataset.tool === activeTool;
    button.classList.toggle('is-active', selected); button.setAttribute('aria-pressed', String(selected));
  });
  updateStrengthControl();
  pinchActive = false;
  pinchHasContact = false;
  previousPullPoint = null;
  pinchCue.visible = false;
  showToolInstructions();
}

toolButtons.forEach((button) => {
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', () => { cancelMouseStroke(); activeTool = button.dataset.tool; lastPinchHint = false; resetToolControls(); });
});

symmetryButton.addEventListener('pointerdown', event => event.stopPropagation());
symmetryButton.addEventListener('click', () => {
  // Keep the setting fixed for each stroke, including its undo history.
  cancelMouseStroke();
  symmetryEnabled = !symmetryEnabled;
  symmetryButton.setAttribute('aria-pressed', String(symmetryEnabled));
  symmetryButton.classList.toggle('is-active', symmetryEnabled);
  document.querySelector('#symmetry-state').textContent = symmetryEnabled ? 'On' : 'Off';
  sceneHint.textContent = symmetryEnabled ? 'Symmetry on · new drags mirror across the center' : 'Symmetry off · shape either side freely';
});

function clearPreview() {
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
}

function drawPreviewSkeleton(landmarks, clear = true) {
  if (!video.videoWidth) return;
  const width = previewCanvas.clientWidth;
  const height = previewCanvas.clientHeight;
  if (previewCanvas.width !== Math.round(width * devicePixelRatio) || previewCanvas.height !== Math.round(height * devicePixelRatio)) {
    previewCanvas.width = Math.round(width * devicePixelRatio);
    previewCanvas.height = Math.round(height * devicePixelRatio);
  }
  previewContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  if (clear) clearPreview();
  const points = landmarks.map(point => {
    const mapped = cameraCoverPoint(point, video.videoWidth, video.videoHeight, width, height);
    return { x: mapped.x * width, y: mapped.y * height };
  });
  previewContext.lineCap = 'round';
  previewContext.lineJoin = 'round';
  previewContext.lineWidth = 2;
  previewContext.strokeStyle = 'rgba(255, 220, 195, .88)';
  for (const [start, end] of connectionLines) {
    previewContext.beginPath();
    previewContext.moveTo(points[start].x, points[start].y);
    previewContext.lineTo(points[end].x, points[end].y);
    previewContext.stroke();
  }
  points.forEach((point, index) => {
    previewContext.beginPath();
    previewContext.arc(point.x, point.y, index === 0 || index === 4 || index === 8 ? 3.5 : 2.5, 0, Math.PI * 2);
    previewContext.fillStyle = index === 4 || index === 8 ? '#ffd4a6' : '#fff4e7';
    previewContext.fill();
  });
}

function mapHandPoints(points, screenSpace) {
  const scaleX = 4.8;
  const scaleY = Math.min(4.8 * (sceneHost.clientHeight / sceneHost.clientWidth), 3.5);
  const arHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  // Image-space landmarks already carry camera perspective: nearer hands occupy more pixels.
  // MediaPipe landmark Z is relative to the wrist, not a global camera-distance value.
  const pointAt = (point) => {
    if (arView.live || screenSpace) {
      const mapped = arView.live ? cameraCoverPoint(point, video.videoWidth, video.videoHeight, sceneHost.clientWidth, sceneHost.clientHeight) : { x: 1 - point.x, y: point.y };
      return { x: (mapped.x - 0.5) * arHeight * camera.aspect, y: (0.5 - mapped.y) * arHeight, z: 0 };
    }
    return {
      x: (0.5 - point.x) * scaleX,
      y: (0.5 - point.y) * scaleY,
      // MediaPipe depth gets smaller toward the camera; Three.js uses +Z.
      z: -point.z * 2.3,
    };
  };
  return points.map(point => {
    const p = pointAt(point);
    return new THREE.Vector3(p.x, p.y, p.z);
  });
}

function updateThreeSkeleton(landmarks, now, pinchOverride = null, worldLandmarks = null, handedness = '', screenSpace = false, sampleAt = now) {
  if (!smoothedPoints || gapStartedAt !== null) handMotion.reset();
  smoothedPoints = handMotion.update(landmarks, sampleAt, now);
  if (!smoothedPoints) { showNoHand(now); return; }
  const mappedPoints = mapHandPoints(smoothedPoints, screenSpace);
  // Screen-space aim is usable immediately, independently of approximate
  // webcam depth. Freeze edits during missing frames but keep a brief grab.
  if (gapStartedAt !== null) {
    const midpointShift = poseTarget ? new THREE.Vector3(mappedPoints[8].x, mappedPoints[8].y, mappedPoints[8].z).distanceTo(poseTarget[8]) : 0;
    if (now - gapStartedAt > 700 || midpointShift > (activeTool === 'cut' ? 0.2 : 1.2)) cancelMouseStroke();
    // Preserve the original drag origin through a brief miss. Rebasing on
    // every recovery silently loses the movement made between detections.
    previousPullCursorPoint = null;
    gapStartedAt = null; poseDisplayed = null;
  }
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
  if(controlMode==='palm') {
    palmControlState=palmControl.update(landmarks,sampleAt,aspect);
    trackingTrace.record('sculpt-palm',{...palmControl.diagnostic,phase:palmControlState.phase,valid:palmControlState.valid,held:palmControlState.held});
    if(palmControl.diagnostic.reason && (palmControl.diagnostic.heldBefore || previousPullPoint))trackingTrace.incident(palmControl.diagnostic.reason,{...palmControl.diagnostic,grabbing:Boolean(previousPullPoint)});
    if(!palmControlState.valid) {
      poseTarget=null;clayVolume.surfacePaint?.breakPath();
      if(palmControlState.phase==='lost')cancelMouseStroke();
      sceneHint.textContent='Tracking paused · show your palm, then open your hand';return;
    }
    const cursor=mapHandPoints([palmControlState.point],screenSpace)[0];
    mappedPoints[8]=cursor;mappedPoints[4]=cursor.clone();
    pinchGesture.held=palmControlState.held;
    moveIntent=false;
    if(palmControlState.open){singleHandNeedsOpen=false;palmGesture.reset();}
  } else if (!showPalmMove(landmarks, now, aspect, screenSpace)) pinchGesture.update(landmarks, now, aspect);
  if(!pinchGesture.held)pinchActive=false;
  if(activeTool==='paint' && !pinchGesture.held)clayVolume.surfacePaint?.finish();
  // End the grab before this open-hand pose can enter render interpolation.
  if (activeTool === 'pinch' && previousPullPoint && !pinchGesture.held) {
    pinchActive = false;
    pullClayAlongPath(null, false);
    pinchCue.visible = false;
  }
  if (activeTool === 'erase' && !pinchGesture.held) {
    clayVolume.surfaceErase?.finish(); pinchActive = false; brushCue.visible = false; mirroredBrush.visible = false;
  }
  poseTarget = mappedPoints;
  poseSampleAt = sampleAt; poseScreenSpace = screenSpace;
  // Consume confirmed held movement on arrival, independently of paint or
  // worker timing. Open-hand poses can never overwrite the last held target.
  if (activeTool === 'extrude' && !pinchGesture.held) {
    clayVolume.surfaceExtrude?.finish(); previousPullPoint=null; grabCursorOrigin=null; grabAnchor=null;
  }
  if ((activeTool === 'pinch' || activeTool === 'extrude' || activeTool === 'paint') && pinchGesture.held && usableHandSample(sampleAt, now)) {
    const point=activeTool === 'pinch' ? mappedPoints[8] : mappedPoints[8].clone().lerp(mappedPoints[4],.5);
    processSculptPoint(point, true);
  }
  if(controlMode==='palm' && palmControlState) {
    stageCaption.textContent=palmControlState.held ? 'PALM GRIP · OPEN TO RELEASE' : 'PALM CONTROL · CLOSE HAND TO APPLY';
    if(palmControlState.phase==='open-first')sceneHint.textContent='Open your hand briefly to get ready';
    else if(!palmControlState.held)sceneHint.textContent='Move your palm to aim · close gently to apply';
  }
  reachCalibration.panel.open = false;
  depthGuide.hidden = true;
}

function processErase(handPoint, held, wasHeld, cursorInput = false) {
  grabTether.visible = false; pinchCue.visible = false; contactCue.visible = false;
  if (!held) {
    clayVolume.surfaceErase?.finish();
    const hit = getClaySurfaceHit(handPoint);
    brushCue.visible = Boolean(hit);
    if (hit) {
      brushCue.position.copy(hit.worldPoint); brushCue.position.z += .035;
      brushCue.scale.setScalar(brushRadius() * clay.scale.x);
      brushCue.material.color.set('#286743');
    }
    contactLabel.textContent = cursorInput ? 'Hold to erase' : 'Pinch to erase';
    return;
  }
  const planeZ = .9;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -clay.localToWorld(new THREE.Vector3(0, 0, planeZ)).z);
  clayRaycaster.set(camera.position, new THREE.Vector3(handPoint.x, handPoint.y, 0).sub(camera.position).normalize());
  const world = clayRaycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!world) return;
  const point = clay.worldToLocal(world.clone());
  if (!wasHeld || !clayVolume.surfaceErase?.active || clayVolume.surfaceErase.released) {
    const volume = clayVolume, item = clayObjects.active;
    volume.surfaceErase ??= new SurfaceErase(volume, event => {
      if (event.changed) { item.edited = true; if (volume === clayVolume) markClayEdited(); }
      if (volume !== clayVolume || activeTool !== 'erase') return;
      if (event.pending) {sceneHint.textContent='Finishing your erasure · your stroke is kept while the surface updates';return;}
      if (event.error) { sceneHint.textContent = 'Erase could not finish · completed parts are kept; the unfinished preview was not saved. Undo to restore the stroke.'; return; }
      if (event.done) {
        if(event.changed)queueMicrotask(()=>{if(volume===clayVolume)studioTutorial?.recordAction('erase',{changed:true});});
        sceneHint.textContent = event.changed ? 'Erased · Undo brings it back' : 'Point the circle at the mask and pinch again';
        stageCaption.textContent = 'ERASE · READY FOR ANOTHER STROKE';
      }
    });
    if (!volume.surfaceErase.begin(brushRadius(), clay.worldToLocal(camera.position.clone()).toArray(), planeZ, symmetryEnabled)) {
      sceneHint.textContent = 'Preparing the surface · keep holding to begin when ready'; return;
    }
  }
  const eraser = clayVolume.surfaceErase;
  if (!eraser?.active || eraser.released) return;
  brushCue.visible = true; brushCue.position.copy(world);
  brushCue.scale.setScalar(eraser.radius * clay.scale.x); brushCue.material.color.set('#286743');
  eraser.update([point.x, point.y]);
  stageCaption.textContent = 'ERASING · RELEASE TO STOP'; lastPinchHint = true;
  sceneHint.textContent = 'Brush away the mask inside the circle · release to stop';
  contactLabel.textContent = 'Erasing';
}

function processCut(handPoint, held, wasHeld, cursorInput = false) {
  brushCue.visible = false; grabTether.visible = false; pinchCue.visible = false; mirroredBrush.visible = false;
  const planeZ = 0.9;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -clay.localToWorld(new THREE.Vector3(0, 0, planeZ)).z);
  clayRaycaster.set(camera.position, new THREE.Vector3(handPoint.x, handPoint.y, 0).sub(camera.position).normalize());
  const world = clayRaycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!world) return;
  const cursor = clay.worldToLocal(world.clone());
  contactCue.visible = true; contactCue.position.copy(world); contactCue.scale.setScalar(0.42);
  contactCue.material.color.set('#c86348');
  if (held && !wasHeld && !cutStroke) {
    if (clayVolume.meshQueue?.pending) { sceneHint.textContent = 'Mask is getting ready · open your fingers, then pinch again'; return; }
    clayVolume.meshQueue?.pauseRefinement?.();
    cutStroke = { points: [], length: 0, volume: clayVolume, item: clayObjects.active,
      eye: clay.worldToLocal(camera.position.clone()).toArray(), planeZ, symmetry: symmetryEnabled };
  }
  if (held && cutStroke) {
    const point = [cursor.x, cursor.y], previous = cutStroke.points.at(-1);
    const distance = previous ? Math.hypot(point[0] - previous[0], point[1] - previous[1]) : 0;
    if (!previous || distance >= 0.007) {
      if (cutStroke.points.length >= 2048) { cancelMouseStroke(); sceneHint.textContent = 'Try a shorter outline'; return; }
      cutStroke.points.push(point); cutStroke.length += distance;
      for (const [line, mirrored] of [[cutPreview, false], [mirroredCutPreview, true]]) {
        const positions = line.geometry.attributes.position;
        cutStroke.points.forEach(([x, y], i) => {
          const p = clay.localToWorld(new THREE.Vector3(mirrored ? -x : x, y, planeZ)); positions.setXYZ(i, p.x, p.y, p.z);
        });
        positions.needsUpdate = true; line.geometry.setDrawRange(0, cutStroke.points.length);
        line.visible = !mirrored || cutStroke.symmetry;
      }
    }
    const first = cutStroke.points[0];
    const loopReady = cutStroke.length > 0.22 && cutStroke.points.length >= 6 && Math.hypot(cursor.x - first[0], cursor.y - first[1]) < 0.08;
    cutPreview.material.color.set(loopReady ? '#538c68' : '#c86348');
    mirroredCutPreview.material.color.copy(cutPreview.material.color);
    contactLabel.textContent = loopReady ? 'Loop ready · release to cut' : 'Tracing · release to cut';
    sceneHint.textContent = loopReady ? 'Loop closed · release to remove the smaller piece' : 'Trace to the other edge, or back to the start · release to cut';
    stageCaption.textContent = cursorInput ? 'CUT OUTLINE · FOLLOW YOUR CURSOR' : 'CUT OUTLINE · FOLLOW YOUR INDEX'; lastPinchHint = true;
  } else if (!held && cutStroke) {
    const stroke = cutStroke; cutStroke = null;
    cutPreview.visible = false; mirroredCutPreview.visible = false;
    if (stroke.points.length < 2 || stroke.length < 0.12) {
      clayVolume.meshQueue?.resumeRefinement?.();
      sceneHint.textContent = 'Trace a longer cut, then release.'; stageCaption.textContent = 'CUT · TRACE AN OUTLINE';
      contactLabel.textContent = 'Mask kept unchanged'; return;
    }
    const { volume, item } = stroke;
    volume.surfaceCut ??= new SurfaceCut(volume, data => {
      if (data.valid) { item.edited = true; if (volume === clayVolume) markClayEdited(); }
      if (volume !== clayVolume || activeTool !== 'cut') return;
      if (data.progress !== undefined) { sceneHint.textContent = 'Finishing your cut…'; return; }
      if (data.valid) {
        sceneHint.textContent = 'Smaller piece removed · Undo brings it back'; stageCaption.textContent = 'CUT COMPLETE';
        contactLabel.textContent = 'Cut complete';
        setPrompt('Cut complete.', 'The smaller piece has disappeared. Trace another cut or use Undo to bring it back.', 'success');
      } else {
        sceneHint.textContent = data.reason ?? 'Cut could not finish · try again'; contactLabel.textContent = 'Mask kept unchanged';
        setPrompt('Complete the outline.', data.reason ?? 'Try the cut again. Your mask is unchanged.', 'neutral');
      }
    });
    volume.surfaceCut.finish(stroke.points, stroke.eye, stroke.planeZ, stroke.symmetry);
    sceneHint.textContent = 'Finishing your cut…'; stageCaption.textContent = 'FINISHING CUT';
  } else {
    contactLabel.textContent = cursorInput ? 'Click to start a cut' : 'Pinch to start a cut';
  }
}

function processHandPose(mappedPoints, pinchOverride = null, editPoints = mappedPoints, handSurfacePoints = mappedPoints) {
  if (tryOn.enabled || resizeEnabled) return;
  if (arView.live) handModel.visible = false;
  // Palm aiming uses a shared cursor for thumb/index input, but the displayed
  // fingers retain their tracked positions instead of stretching to that cursor.
  else updateHandSurface(handSurfacePoints);
  scenePlaceholder.classList.add('is-hidden');
  const pinchDistance = new THREE.Vector3().subVectors(editPoints[4], editPoints[8]).length();
  const palmWidth = Math.max(0.04, new THREE.Vector3().subVectors(editPoints[5], editPoints[17]).length());
  const index = (activeTool === 'erase' || activeTool === 'extrude' || activeTool === 'paint') && pinchOverride ? editPoints[8].clone().lerp(editPoints[4], .5) : editPoints[8];
  processSculptPoint(new THREE.Vector3(index.x, index.y, index.z), pinchOverride, pinchDistance / palmWidth);
}

// Cursor and hand input share geometry, symmetry, history, and release behavior.
// Cursor input bypasses gesture recognition and the virtual hand entirely.
function processSculptPoint(sculptPoint, pinchOverride, pinchRatio = 1, cursor = false) {
  if (studioTutorial?.learningUI) return;
  if (tryOn.enabled || resizeEnabled || handUI?.isOpen || editingPaused || handUICaptured) return;
  if (moveIntent || palmMove.active) return;
  if (clayVolume.meshFailed) {
    cancelMouseStroke();
    setPrompt('Clay updates paused.', 'The background sculpting worker stopped. Reload the page to restart the studio.', 'warning');
    return;
  }
  if (clayMenu?.isOpen) {
    cancelMouseStroke();
    contactCue.visible = false;
    contactLabel.textContent = 'Close the menu to sculpt';
    return;
  }
  if (isBrushApplying()) { showApplyingBrush(sculptPoint); return; }
  if (volumeBusy()) return;
  if (activeSize === 0 && (activeTool === 'pinch' || activeTool === 'erase' || activeTool === 'extrude' || activeTool === 'paint')) {
    brushCue.visible = false; contactCue.visible = false; pinchCue.visible = false;
    contactLabel.textContent = 'Brush off · increase Size';
    sceneHint.textContent = 'Size is 0% · increase Size to sculpt';
    setPrompt('Brush is off.', 'Increase Size above 0% to sculpt the mask.', 'neutral');
    return;
  }
  const wasPinching = pinchActive;
  if (pinchOverride !== null) pinchActive = pinchOverride;
  else if (!pinchActive && pinchRatio < 0.34) pinchActive = true;
  else if (pinchActive && pinchRatio > 0.48) pinchActive = false;

  if(activeTool==='paint') {
    const paintRadius=Math.max(.04,Math.min(.5,brushRadius()));
    const hit=getClaySurfaceHit(sculptPoint);
    brushCue.visible=Boolean(hit);contactCue.visible=false;grabTether.visible=false;
    if(hit) {
      brushCue.position.copy(hit.worldPoint);brushCue.position.z+=.025;
      brushCue.scale.setScalar(paintRadius*clay.scale.x);brushCue.material.color.set('#286743');
    }
    if(!pinchActive){clayVolume.surfacePaint?.finish();return;}
    if(!hit){clayVolume.surfacePaint?.breakPath();return;}
    const volume=clayVolume,item=clayObjects.active;
    volume.surfacePaint ??=new SurfacePaint(volume,(point,stroke)=>{item.edited=true;if(volume===clayVolume)markClayEdited();
      queueMicrotask(()=>{if(volume===clayVolume)studioTutorial?.recordPaint(point,stroke);});});
    if(!volume.surfacePaint.active && !volume.surfacePaint.begin(paintRadius,paintColor,symmetryEnabled))return;
    const normal=hit.worldNormal.clone().transformDirection(clay.matrixWorld.clone().invert());
    volume.surfacePaint.update(hit.point,normal);
    sceneHint.textContent='Painting · release to keep your stroke';return;
  }

  if (activeTool === 'extrude') {
    const hover = getClaySurfaceHit(sculptPoint);
    brushCue.visible = Boolean(hover); contactCue.visible=false; grabTether.visible=false;
    brushCue.scale.setScalar(brushRadius() * clay.scale.x);
    brushCue.material.color.set('#286743');
    if (hover) {
      brushCue.position.copy(hover.worldPoint); brushCue.position.z += .035;
      brushCue.scale.setScalar(brushRadius() * clay.scale.x);
      brushCue.material.color.set('#286743');
    }
    if (!pinchActive) {
      clayVolume.surfaceExtrude?.finish(); previousPullPoint=null; grabCursorOrigin=null; grabAnchor=null;
      return;
    }
    if (!clayVolume.surfaceExtrude?.active) {
      const hit=getClaySurfaceHit(sculptPoint);
      if (!hit || (clayVolume.meshQueue?.pending && !clayVolume.surfaceExtrude?.canBegin)) return;
      const volume=clayVolume;
      volume.surfaceExtrude ??= new SurfaceExtrude(volume,()=>{
        if(volume===clayVolume)markClayEdited();
        const points=volume.extrusion?.points;
        queueMicrotask(()=>{if(volume===clayVolume)studioTutorial?.recordAction('extrude',{points});});
      });
      if (!volume.surfaceExtrude.begin(hit.point,brushRadius(),symmetryEnabled)) {
        sceneHint.textContent='Your strokes are catching up · release before starting the next one';
        return;
      }
      grabAnchor=hit.point.clone(); previousPullPoint=hit.point.clone();
      pullPlane.constant=-clay.localToWorld(hit.point.clone()).z;
      grabCursorOrigin=null;
    }
    clayRaycaster.set(camera.position,new THREE.Vector3(sculptPoint.x,sculptPoint.y,0).sub(camera.position).normalize());
    const projected=clayRaycaster.ray.intersectPlane(pullPlane,new THREE.Vector3());
    if (!projected) return;
    const local=clay.worldToLocal(projected);
    grabCursorOrigin ??= local.clone();
    const delta=local.clone().sub(grabCursorOrigin);
    const target=grabAnchor.clone().add(delta);
    target.z+=Math.min(.55,delta.length()*.22);
    clayVolume.surfaceExtrude.update(target);
    previousPullPoint=target;
    brushCue.visible = true;
    brushCue.position.copy(clay.localToWorld(target.clone())); brushCue.position.z += .035;
    sceneHint.textContent='Extruding · trace your curve, then release for a narrow tip';
    return;
  }

  if (activeTool === 'erase') {
    processErase(sculptPoint, pinchActive, wasPinching, cursor);
    diagnostics.pinch = pinchActive ? 'held' : 'open'; diagnostics.pause = 'none';
    return;
  }
  if (activeTool === 'cut') {
    processCut(sculptPoint, pinchActive, wasPinching, cursor);
    diagnostics.pinch = pinchActive ? 'held' : 'open'; diagnostics.pause = 'none';
    return;
  }
  contactCue.material.color.set('#7cb58b');
  let surfaceHit = previousPullPoint ? null : getClaySurfaceHit(sculptPoint);
  if (!previousPullPoint) {
    const now = performance.now();
    if (surfaceHit && !pinchActive) { recentGrabHit = surfaceHit; recentGrabAt = now; }
    // Closing the fingers can shift the tracked fingertip off an edge. Keep
    // the patch the user just pointed at, rather than making them aim again.
    if (!cursor && !surfaceHit && pinchActive && !wasPinching && recentGrabHit && now - recentGrabAt < 220
      && Math.hypot(recentGrabHit.worldPoint.x - sculptPoint.x, recentGrabHit.worldPoint.y - sculptPoint.y) < 0.2) surfaceHit = recentGrabHit;
  }
  const contact = surfaceHit;
  contactCue.visible = !cursor && Boolean(contact) && activeSize > 0;
  contactCue.scale.setScalar(Math.min(1, brushRadius() * clay.scale.x / 0.065 * 0.3));
  if (contactCue.visible) contactCue.position.copy(contact.worldPoint);
  contactLabel.textContent = previousPullPoint && pinchActive ? 'Patch grabbed · drag to reshape' : contact ? 'Ready to grab' : 'Point at the mask';
  brushCue.visible = Boolean(contact) && !previousPullPoint && activeSize > 0;
  if (brushCue.visible) {
    brushCue.position.copy(contact.worldPoint); brushCue.position.z += 0.035;
    brushCue.scale.setScalar(brushRadius() * clay.scale.x);
    brushCue.material.color.set('#286743');
  }
  diagnostics.pinch = pinchActive ? 'held' : 'open';
  diagnostics.pause = 'none';
  contactLabel.dataset.contact = String(Boolean(contact));
  const sculptStartedAt = performance.now();
  pullClayAlongPath(sculptPoint, pinchActive, surfaceHit?.point ?? null);
  if (previousPullPoint) {
    pinchCue.position.copy(clay.localToWorld(previousPullPoint.clone()));
    pinchCue.position.z += 0.09;
    brushCue.visible = true;
    brushCue.position.copy(pinchCue.position);
    brushCue.scale.setScalar(brushRadius() * clay.scale.x);
    brushCue.material.color.set('#286743');
  }
  const hasPinchContact = pinchActive && Boolean(previousPullPoint);
  if (hasPinchContact) {
    pinchCue.material.color.set('#7cb58b'); grabTether.material.color.set('#538c68');
  }
  pinchCue.visible = hasPinchContact;
  pinchCue.scale.setScalar(pinchActive ? 1.12 : 0.8);
  diagnostics.sculptMs = performance.now() - sculptStartedAt;
  if ((pinchActive !== wasPinching || hasPinchContact !== pinchHasContact)) {
    lastPinchHint = true;
    if (pinchActive) {
      if (hasPinchContact) {
        stageCaption.textContent = 'PATCH GRABBED · DRAG TO RESHAPE';
        sceneHint.textContent = 'Drag your patch · release to keep it · Undo to try again';
        setPrompt('You have the patch.', cursor ? 'Keep the mouse button held and drag. Release to keep this shape; Undo reverses the change.' : 'Keep your fingers pinched and move your hand. The patch follows your drag. Open your fingers to release; Undo reverses the change.', 'success');
      } else {
        stageCaption.textContent = 'PINCH ACTIVE · FIND THE CLAY';
        sceneHint.textContent = clayVolume.pulling || clayVolume.meshQueue?.pending ? 'Finishing the last change…' : 'Point at a solid patch until the green ring appears';
        setPrompt('Find a patch.', 'Aim at the visible mask surface. Eye openings have no material to grab.', 'neutral');
      }
    } else {
      if (pinchHasContact) {
        stageCaption.textContent = 'RELEASED · READY FOR ANOTHER PATCH';
        sceneHint.textContent = 'Released · point at another patch or Undo';
        setPrompt('Released.', cursor ? 'Your shape is kept. Click and drag another patch, or Undo the last change.' : 'Check your shape. Undo reverses the last change; pinch another patch to keep creating.', 'success');
      } else {
        showToolInstructions();
      }
    }
  }
  pinchHasContact = hasPinchContact;
}

function showTracking(landmarks, now, worldLandmarks, handedness, sampleAt = now) {
  lastHandAt = now;
  noHandSince = 0;
  wasTracking = true;
  setStatus('ready', 'HAND DETECTED');
  landmarkCount.textContent = '21 LANDMARKS · 1 HAND';
  tipHeading.textContent = 'Hand in view';
  tipCopy.textContent = toolDetails().tipCopy;
  if (!lastPinchHint && !pinchActive) {
    const details = toolDetails();
    setPrompt(details.title, details.body, 'success');
    stageCaption.textContent = `HAND TRACKED · ${details.caption.replace(/^[^·]+·\s*/, '')}`;
    sceneHint.innerHTML = details.hint;
  }
  document.querySelector('#check-hand').classList.add('is-done');
  updateThreeSkeleton(landmarks, now, null, worldLandmarks, handedness, true, sampleAt);
}

function pauseTracking(now,reason='tracking-pause') {
  if(controlMode==='palm' && gapStartedAt===null && (previousPullPoint || pinchGesture.held))trackingTrace.incident(reason,{grabbing:Boolean(previousPullPoint),held:pinchGesture.held,poseGapMs:now-handMotion.receivedAt,inferenceMs:diagnostics.inferenceMs,roundTripMs:diagnostics.roundTripMs,frameMs:diagnostics.frameMs,sculptMs:diagnostics.sculptMs});
  if(controlMode==='palm' && gapStartedAt===null) {
    cancelMouseStroke();handUI?.palmInput?.lose();
    sceneHint.textContent='Tracking paused · open your hand when it returns';
  }
  clayVolume.surfaceErase?.finish(); mirroredBrush.visible = false;
  if (palmMove.active || moveIntent) {
    finishMoveStroke(); sceneHint.textContent = 'Position kept · bring your hand back to keep creating';
  }
  if (gapStartedAt === null) { gapStartedAt = now; diagnostics.dropouts++; pinchGesture.uncertain(); }
  diagnostics.pause = 'tracking uncertain';
  contactCue.visible = false;
  brushCue.visible = false;
  pinchCue.material.color.set('#d6a355'); grabTether.material.color.set('#d6a355');
  if (cutStroke) {
    contactLabel.textContent = 'Cut paused · bring your hand back';
    sceneHint.textContent = 'Hand briefly lost · your outline is held, cutting is paused';
  }
  if (previousPullPoint) {
    contactLabel.textContent = 'Grab paused · bring your hand back';
    sceneHint.textContent = 'Hand briefly lost · your patch is held, edits are paused';
  }
  if (now - gapStartedAt > 700) {
    cancelMouseStroke();
    handModel.visible = false;
  }
}

function showNoHand(now,reason='hand-unavailable') {
  setResizeMode(false);
  pauseTracking(now,reason);
  if (now - gapStartedAt <= 700) {
    contactLabel.textContent = 'Tracking paused · hold your pose';
    return;
  }
  reachCalibration.loseHand(now);
  contactCue.visible = false;
  contactLabel.textContent = 'Hand out of view';
  contactLabel.dataset.contact = 'false';
  if (!noHandSince) noHandSince = now;
  clearPreview();
  pinchActive = false;
  pinchHasContact = false;
  previousPullPoint = null;
  pinchCue.visible = false;
  landmarkCount.textContent = '21 LANDMARKS · WAITING';
  const lost = wasTracking && now - lastHandAt > 900;
  if (now - lastHandAt > 180) handModel.visible = false;
  const needsHint = now - noHandSince > 2800;
  if (lost) {
    handModel.visible = false;
    scenePlaceholder.classList.remove('is-hidden');
    smoothedPoints = null;
    setStatus('searching', 'LOOKING FOR HAND');
    setPrompt('Oops, we lost your hand.', 'Bring it back into the frame. Try a little more light and keep your wrist visible.', 'warning');
    stageCaption.textContent = 'HAND OUT OF FRAME';
    sceneHint.innerHTML = '<span class="hint-icon">↗</span> Bring your hand back into the frame';
    tipHeading.textContent = 'Bring your hand back';
    tipCopy.textContent = 'Keep your palm facing the camera and move a little closer to the light.';
  } else {
    setStatus('searching', 'LOOKING FOR HAND');
    setPrompt(needsHint ? 'We’re still looking for your hand.' : 'Show us one hand', needsHint ? 'Try bringing your whole hand and wrist into view, palm facing the camera.' : 'Hold your hand in the frame, palm facing the camera.', needsHint ? 'warning' : 'neutral');
    stageCaption.textContent = 'LOOKING FOR YOUR HAND';
    sceneHint.innerHTML = '<span class="hint-icon">↗</span> Palm toward the camera, wrist in view';
  }
  lastPinchHint = false;
}

function scheduleHandTracking() {
  handFramePump?.stop();
  lastCaptureAt = null;
  // Restart the same pump across mode changes: its busy flag remains set
  // until the previous inference settles, preventing overlapping hand jobs.
  handFramePump ??= new VideoFramePump(video, frame => trackingLoop(trackingEpoch, frame), {
    interval: () => Math.max(landmarker?.minInterval ?? 0, tryOn.enabled ? 80 : 0),
    canRun: () => Boolean(stream && landmarker),
  });
  handFramePump.start();
}

async function trackingLoop(epoch, frame) {
  const tracker = landmarker;
  if (!stream || !tracker || epoch !== trackingEpoch) return false;
  let phase = 'frame capture / inference';
  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const capturedAt = performance.now();
      const result = await tracker.detectForVideo(video, capturedAt);
      if (epoch !== trackingEpoch || tracker !== landmarker || !stream) return false;
      diagnostics.inferenceMs = tracker.duration;
      diagnostics.captureMs = tracker.captureMs ?? 0;
      diagnostics.roundTripMs = performance.now() - capturedAt;
      diagnostics.resultAgeMs = performance.now() - frame.sampleAt;
      diagnostics.frameTiming = frame.timingSource;
      diagnostics.trackingHz = lastCaptureAt === null ? 0 : 1000 / Math.max(1, capturedAt - lastCaptureAt);
      lastCaptureAt = capturedAt;
      if (result.landmarks?.length) lastTryHandAt = performance.now();
      // The frame pump and tracking budget already back off during expensive
      // sculpting. A slow burst must not permanently remove the second hand.
      phase = 'landmark processing';
      // Never sculpt using an old result after a long inference stall.
      if (performance.now() - frame.sampleAt >= HAND_UI_SAMPLE_AGE_MS) {
        handUI?.suspend(performance.now());
        if (!tryOn.enabled) showNoHand(performance.now(),'tracking-result-over-500ms');
      } else processHandResult(result, performance.now(), frame.sampleAt);
    }
  } catch (error) {
    if (epoch !== trackingEpoch || tracker !== landmarker) return false;
    console.error('Tracking interrupted:', error);
    if (!tryOn.enabled) showNoHand(performance.now());
    cancelMouseStroke();
    const detail = `${tracker.mode ?? 'unknown'} · ${phase}: ${error.name ?? 'Error'}: ${error.message ?? String(error)}`;
    diagnostics.lastError = detail;
    diagnostics.pause = 'tracking error';
    try { tracker.close(); } catch (closeError) { console.warn('Tracking cleanup:', closeError); }
    landmarker = null;
    handUI?.lose();
    poseTarget = null;
    poseDisplayed = null;
    handModel.visible = false;
    if (tracker.mode === 'worker' && phase === 'frame capture / inference') {
      setResizeMode(false);
      setStatus('loading', 'RECONNECTING TRACKING');
      buttonLabel.textContent = 'Reconnecting…';
      cameraButton.disabled = true;
      setPrompt('Reconnecting hand tracking…', 'Background tracking stopped responding. Switching to compatibility mode; keep your hand in view.', 'neutral');
      let replacement;
      try {
        replacement = await TrackingClient.createCompatibility();
        if (epoch !== trackingEpoch || !stream) { replacement.close(); return false; }
        await configureResizeTracking(replacement);
        if (epoch !== trackingEpoch || !stream) { replacement.close(); return false; }
        landmarker = replacement;
        diagnostics.trackingMode = replacement.mode;
        diagnostics.pause = 'none';
        lastPinchHint = false;
        gapStartedAt = null;
        reachCalibration.reset();
        cameraButton.disabled = false;
        buttonLabel.textContent = 'Camera on';
        setStatus('searching', 'LOOKING FOR HAND');
        setPrompt('Tracking reconnected.', 'Show an open palm, then calibrate your reach. Compatibility mode is active.', 'success');
        scheduleHandTracking();
        return false;
      } catch (recoveryError) {
        replacement?.close();
        if (epoch !== trackingEpoch || !stream) return false;
        diagnostics.lastError = `${detail}; recovery: ${recoveryError.message}`;
        console.error('Tracking recovery failed:', recoveryError);
      }
    }
    setStatus('error', 'TRACKING ERROR');
    stageCaption.textContent = 'TRACKING STOPPED';
    landmarkCount.textContent = 'TRACKING ERROR · CAMERA STILL ON';
    buttonLabel.textContent = 'Retry tracking';
    cameraButton.classList.remove('is-secondary');
    cameraButton.disabled = false;
    mouseButton.hidden = false;
    setPrompt('Tracking stopped — error details', `${diagnostics.lastError}. Use Retry tracking to reconnect.`, 'warning');
    tipHeading.textContent = 'The camera is working.';
    tipCopy.textContent = 'Tracking stopped because of a software error. See the error details below the play area.';
    return false;
  }
  return epoch === trackingEpoch && Boolean(stream);
}

async function configureResizeTracking(tracker) {
  try {
    await tracker.setHandCount(2);
    resizeAutoPaused = false;
  } catch (error) {
    console.warn('Two-hand tracking unavailable:', error);
    await tracker.setHandCount(1);
    resizeAutoPaused = true;
  }
  updateResizeControl();
}

async function createLandmarker() {
  try {
    const tracker = await TrackingClient.createBackgroundHands();
    resizeAutoPaused = false; updateResizeControl();
    return tracker;
  }
  catch (error) { console.warn('Background two-hand tracking unavailable:', error); }
  const tracker = await TrackingClient.create();
  try { await configureResizeTracking(tracker); }
  catch (error) { tracker.close(); throw error; }
  return tracker;
}

async function startTracking() {
  if (tryOn.enabled) return;
  cameraButton.disabled = true;
  buttonLabel.textContent = 'Loading tracking…';
  setStatus('loading', 'SETTING UP');
  landmarkCount.textContent = '21 LANDMARKS · LOADING';
  const epoch = ++trackingEpoch;
  handFramePump?.stop();
  try {
    const tracker = await createLandmarker();
    if (epoch !== trackingEpoch || !stream) { tracker.close(); return; }
    landmarker?.close();
    landmarker = tracker;
    diagnostics.trackingMode = tracker.mode;
    diagnostics.pause = 'none';
    delete diagnostics.lastError;
    lastPinchHint = false;
    buttonLabel.textContent = 'Camera on';
    cameraButton.classList.add('is-secondary');
    cameraButton.disabled = false;
    mouseButton.hidden = true;
    setPrompt('Camera’s ready.', 'Use one hand to edit. Show both hands to resize automatically.', 'success');
    scheduleHandTracking();
  } catch (error) {
    if (epoch !== trackingEpoch || !stream) return;
    console.error('ClayPlay hand tracking setup failed:', error);
    cameraButton.disabled = false;
    buttonLabel.textContent = 'Retry tracking';
    cameraButton.classList.remove('is-secondary');
    mouseButton.hidden = false;
    setStatus('error', 'TRACKING UNAVAILABLE');
    landmarkCount.textContent = '21 LANDMARKS · OFFLINE';
    setPrompt('Your camera is on, but tracking didn’t load.', 'The tracking engine could not start in either mode. Retry tracking; if it still fails, check your connection and reload the page.', 'warning');
    tipHeading.textContent = 'The camera is still on.';
    tipCopy.textContent = 'Retry tracking, or choose Use cursor to turn the camera off and keep creating.';
  }
}

function startCamera() {
  if (cameraOpening) return cameraStartup;
  cameraStartup = openCamera();
  return cameraStartup;
}

async function openCamera() {
  cameraOpening = true;
  resizeAutoPaused = false; updateResizeControl();
  const requestEpoch = ++cameraRequestEpoch;
  cancelMouseStroke();
  mouseButton.hidden = true;
  handModel.visible = false;
  showToolInstructions();
  cameraButton.disabled = true;
  buttonLabel.textContent = 'Opening camera…';
  setStatus('loading', 'SETTING UP');
  landmarkCount.textContent = '21 LANDMARKS · LOADING';
  setPrompt(tryOn.enabled ? 'Opening your fitting room…' : 'Waking up the studio…',
    tryOn.enabled ? 'Opening your camera, then loading face tracking. Your mask will fit automatically.' : 'Opening your camera, then loading hand tracking. This can take a few seconds.', 'neutral');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    const openedStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 60 } },
    });
    if (requestEpoch !== cameraRequestEpoch) { openedStream.getTracks().forEach(track => track.stop()); return; }
    stream = openedStream;
    diagnostics.cameraHz = openedStream.getVideoTracks()[0]?.getSettings().frameRate ?? 0;
    openedStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (stream === openedStream) { stopCamera(); setPrompt('Camera stopped.', 'Cursor controls are ready. Reconnect your camera whenever you want to use your hands.', 'neutral'); }
    });
    video.srcObject = stream;
    await video.play();
    if (requestEpoch !== cameraRequestEpoch) return;
    videoWidth = video.videoWidth;
    videoHeight = video.videoHeight;
    videoPlaceholder.hidden = true;
    videoLive.classList.add('is-visible');
    cameraPreview.hidden = false;
    cameraStatus.textContent = 'ON';
    cameraStatus.classList.add('is-on');
    document.querySelector('#check-camera').classList.add('is-done');
    if (arView.enabled) await arView.attachStream(stream);
  } catch (error) {
    if (requestEpoch !== cameraRequestEpoch) return;
    console.error('ClayPlay camera access failed:', error);
    stopCamera();
    cameraButton.disabled = false;
    buttonLabel.textContent = 'Try again';
    setStatus('error', 'CAMERA UNAVAILABLE');
    landmarkCount.textContent = '21 LANDMARKS · OFFLINE';
    const isPermission = error.name === 'NotAllowedError' || error.name === 'SecurityError';
    const isUnsupported = error.message === 'unsupported';
    setPrompt(isUnsupported ? 'This browser can’t open a camera here.' : isPermission ? 'Camera access is turned off.' : 'We couldn’t start the camera.', isUnsupported ? 'Open ClayPlay in a modern browser on localhost or a secure connection, or continue with mouse controls.' : isPermission ? 'Allow camera access in your browser’s address bar, then try again. You can also continue without it.' : 'Check that your camera is connected and not being used elsewhere, then try again.', 'warning');
    tipHeading.textContent = 'No camera? That’s okay.';
    tipCopy.textContent = 'Cursor controls are ready. Click and drag to shape, or select Cut and trace an outline, then release.';
    return;
  } finally {
    if (requestEpoch === cameraRequestEpoch) cameraOpening = false;
  }
  if (requestEpoch !== cameraRequestEpoch) return;
  if (tryOn.enabled) {
    cameraButton.disabled = false; buttonLabel.textContent = 'Camera on';
    cameraButton.classList.add('is-secondary'); mouseButton.hidden = true;
  } else await startTracking();
}

function stopCamera(resetLandmarker = true) {
  setResizeMode(false); resizeAutoPaused = false; updateResizeControl();
  endTryOn({ restoreView: false, resumeTracking: false });
  cameraRequestEpoch++; cameraOpening = false;
  arView.setEnabled(false);
  cancelMouseStroke();
  trackingEpoch++;
  poseTarget = null; poseDisplayed = null; gapStartedAt = null;
  pinchGesture.reset();
  palmGesture.reset();
  singleHandNeedsOpen = false;
  reachCalibration.reset();
  contactCue.visible = false;
  pinchActive = false;
  pinchHasContact = false;
  mousePinching = false;
  pinchCue.visible = false;
  handFramePump?.stop(); handMotion.reset();
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  handUI?.reset(); handUICaptured = false; editingPaused = false;
  if (handUI?.isOpen) handUI.close();
  video.srcObject = null;
  if (resetLandmarker && landmarker) {
    landmarker.close();
    landmarker = null;
  }
  cameraStatus.textContent = 'OFF';
  cameraStatus.classList.remove('is-on');
  videoLive.classList.remove('is-visible');
  cameraPreview.hidden = true;
  videoPlaceholder.hidden = false;
  buttonLabel.textContent = 'Set up camera';
  cameraButton.classList.remove('is-secondary');
  cameraButton.disabled = false;
  cameraButton.hidden = false;
  mouseButton.hidden = true;
  if (resetLandmarker) {
    setStatus('idle', 'NOT CONNECTED');
    handModel.visible = false;
    previousPullPoint = null;
    smoothedPoints = null;
    landmarkCount.textContent = '21 LANDMARKS · WAITING';
  }
  scenePlaceholder.classList.add('is-hidden');
  showToolInstructions();
}

cameraButton.addEventListener('click', () => {
  if (stream) {
    if (!landmarker && !tryOn.enabled) {
      startTracking();
      return;
    }
    stopCamera();
    setPrompt('Camera paused · cursor ready.', 'Click and drag to shape, or select Erase and brush while holding the mouse button. Start the camera again whenever you’re ready.');
  } else startCamera();
});

mouseButton.addEventListener('click', () => {
  stopCamera();
});

function updateMouseTarget(event) {
  const bounds = sceneHost.getBoundingClientRect();
  clayRaycaster.setFromCamera(new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    1 - ((event.clientY - bounds.top) / bounds.height) * 2,
  ), camera);
  mouseSculptPoint = clayRaycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
}

sceneHost.addEventListener('pointermove', (event) => {
  if (!cursorInputEnabled() || (mousePointerId !== null && event.pointerId !== mousePointerId)) return;
  updateMouseTarget(event);
  if (mouseSculptPoint) processSculptPoint(mouseSculptPoint, mousePinching, 1, true);
});

sceneHost.addEventListener('pointerdown', (event) => {
  if (tryOn.enabled) return;
  if (event.target !== renderer.domElement || event.button !== 0) return;
  if (mousePointerId !== null || cameraOpening) return;
  updateMouseTarget(event);
  // Click another piece to select it; a subsequent drag sculpts that piece.
  const hit = clayRaycaster.intersectObjects(clayObjects.items.map((item) => item.group), true)[0];
  if (hit) {
    const item = clayObjects.items.find((item) => item.group === hit.object.parent);
    if (item && item !== clayObjects.active) {
      selectClayObject(item.id);
      return;
    }
  }
  if (!cursorInputEnabled() || clayMenu?.isOpen || volumeBusy()) return;
  cancelMouseStroke();
  mousePinching = true;
  mousePointerId = event.pointerId;
  event.preventDefault();
  sceneHost.setPointerCapture(event.pointerId);
  if (mouseSculptPoint) processSculptPoint(mouseSculptPoint, true, 1, true);
});

sceneHost.addEventListener('pointerup', (event) => {
  if (!cursorInputEnabled() || !mousePinching || event.pointerId !== mousePointerId || event.button !== 0) return;
  updateMouseTarget(event);
  mousePinching = false;
  if (mouseSculptPoint) processSculptPoint(mouseSculptPoint, false, 1, true);
  mousePointerId = null;
  if (sceneHost.hasPointerCapture(event.pointerId)) sceneHost.releasePointerCapture(event.pointerId);
});

function cancelMouseStroke() {
  palmControl.reset();palmControlState=null;
  sculptSounds.stop();
  clayVolume.surfacePaint?.finish();
  clayVolume.surfaceExtrude?.finish();
  finishMoveStroke(true);
  finishScaleStroke();
  cutStroke = null; cutPreview.visible = false; mirroredCutPreview.visible = false;
  recentGrabHit = null;
  clayVolume.surfacePull?.finish();
  clayVolume.surfaceErase?.finish();
  brushCue.visible = false; grabTether.visible = false;
  grabCursorOrigin = null; grabAnchor = null;
  pinchGesture.reset();
  contactCue.visible = false;
  contactLabel.dataset.contact = 'false';
  contactLabel.textContent = 'Point at the mask';
  mousePinching = false;
  const pointerId = mousePointerId; mousePointerId = null;
  if (pointerId !== null && sceneHost.hasPointerCapture(pointerId)) sceneHost.releasePointerCapture(pointerId);
  pinchActive = false;
  pinchHasContact = false;
  pinchCue.visible = false;
  previousPullPoint = null;
  previousPullCursorPoint = null;
  clayVolume.meshQueue?.resumeRefinement?.();
}
function volumeBusy() {
  if (clayVolume.surfaceExtrude?.active && activeTool === 'extrude') return false;
  if (clayVolume.erasing) {
    if (clayVolume.surfaceErase?.active && activeTool === 'erase') return false;
    contactLabel.textContent = 'Keeping your erasure…'; return true;
  }
  if (clayVolume.cutting) { contactLabel.textContent = 'Finishing your cut…'; return true; }
  if (clayVolume.pulling && !previousPullPoint) {
    contactLabel.textContent = 'Keeping your change…'; return true;
  }
  return false;
}
sceneHost.addEventListener('pointercancel', event => { if (event.pointerId === mousePointerId) cancelMouseStroke(); });
sceneHost.addEventListener('lostpointercapture', event => { if (event.pointerId === mousePointerId) cancelMouseStroke(); });
sceneHost.addEventListener('pointerleave', () => {
  if (cursorInputEnabled() && !mousePinching) {
    brushCue.visible = false; mirroredBrush.visible = false; contactCue.visible = false;
    recentGrabHit = null;
  }
});
window.addEventListener('blur', () => { if (mousePinching) cancelMouseStroke(); });

clayMenu = setupClayMenu(clayObjects, {
  onSelect: selectClayObject,
  onLayout: () => { cancelMouseStroke(); clayObjects.layout(camera); },
  onPause: (open) => { cancelMouseStroke(); if (open) reachCalibration.panel.open = false; },
});

function pauseForHandUI() {
  cancelMouseStroke(); poseTarget = null; poseDisplayed = null; smoothedPoints = null;
  palmGesture.reset(true); singleHandNeedsOpen = true;
  handModel.visible = false; brushCue.visible = false; mirroredBrush.visible = false;
}

handUI = new HandUI({
  stage: document.querySelector('#stage'),
  mapPoint: point => {
    const rect = document.querySelector('#stage').getBoundingClientRect();
    const mapped = arView.live ? cameraCoverPoint(point, video.videoWidth, video.videoHeight, rect.width, rect.height) : { x: 1 - point.x, y: point.y };
    return { x: rect.left + mapped.x * rect.width, y: rect.top + mapped.y * rect.height };
  },
  getState: () => ({
    active: clayObjects.active.id, eyeShape: clayVolume.eyeShape ?? 'oval', color: activeTool==='paint' ? paintColor : `#${clayObjects.active.material.color.getHexString()}`,
    smoothness: Math.round((1 - clayObjects.active.material.roughness) * 100),
    masks: clayObjects.items.map(item => ({ id: item.id, label: item.label, shape: item.shape, color: `#${item.material.color.getHexString()}` })),
    edited: clayObjects.active.edited, symmetry: symmetryEnabled, ar: arView.enabled, trying: tryOn.enabled,
    selfieBusy:Boolean(selfie?.busy), controlMode, sound: sculptSounds.enabled, paused: editingPaused, cameraOn: Boolean(stream), positionResetDisabled: positionResetButton.disabled,
    trackingIssue:Boolean(trackingTrace.failure),
    busy: Boolean(clayMenu?.isBusy || clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending),
  }),
  onPause: pauseForHandUI,
  onAction: (action, value) => {
    if (action === 'selfie') {if(handUI.isOpen)handUI.close();selfie?.start();}
    else if (action === 'control-mode') setControlMode(value);
    else if (action === 'sound') { sculptSounds.toggle(); handUI.sync(); }
    else if (action === 'color') {if(activeTool==='paint')setPaintColor(value);else clayMenu.setColor(value);}
    else if(action === 'size' && !sizeInput.disabled) {
      sizeInput.value=String(value);sizeInput.dispatchEvent(new Event('input',{bubbles:true}));
    }
    else if (action === 'eye-shape') {
      if (volumeBusy() || clayVolume.meshQueue?.pending || value === clayVolume.eyeShape) return;
      cancelMouseStroke();
      checkpoint(clayVolume);
      clayVolume.setEyeShape(value);
      markClayEdited();
      sceneHint.textContent = 'Eye shape updated · Undo brings the previous eyes back';
    }
    else if (action === 'smoothness') clayObjects.active.material.roughness = 1 - Math.max(0, Math.min(100, Number(value))) / 100;
    else if (action === 'add-mask') clayMenu.addShape(value);
    else if (action === 'select-mask') selectClayObject(value);
    else if (action === 'remove') document.querySelector('#remove-clay').click();
    else if (action === 'reset') resetClay();
    else if (action === 'camera-off') stopCamera();
    else if (action === 'camera-on') { handUI.close(); cameraButton.click(); }
    else if (action === 'tutorial') { studioTutorial.start(); }
    else if(action==='tracking-report') {
      const report=JSON.stringify({diagnostics,...trackingTrace.report()},null,2);
      const copied=navigator.clipboard?.writeText(report) ?? Promise.reject(new Error('Clipboard unavailable'));
      copied.then(()=>{sceneHint.textContent='Issue report copied.';handUI.announce('Issue report copied');},()=>{sceneHint.textContent='Could not copy the report; try clicking with the mouse.';});
    }
    else if (action === 'pause') {
      editingPaused = !editingPaused; pauseForHandUI();
      sceneHint.textContent = editingPaused ? 'Editing paused · choose More, then Resume creating' : (controlMode==='palm' ? 'Ready to create · close your hand on a patch or choose a tool' : 'Ready to create · pinch a patch or choose a tool');
    } else ({ symmetry: symmetryButton, ar: arButton, try: tryButton, position: positionResetButton })[action]?.click();
  },
});

maskShapePicker = new MaskShapePicker({
  stage: document.querySelector('#stage'),
  onOpen: () => { if (handUI.isOpen) handUI.close(); pauseForHandUI(); editingPaused = true; },
  onContinue: () => {
    pauseForHandUI();editingPaused=false;
    showToolInstructions();handUI.sync();
  },
  onChoose: async (shape, eyes) => {
    if (volumeBusy() || clayVolume.meshQueue?.pending) throw new Error('Please wait for your current edit to finish.');
    const item = clayObjects.active;
    // Tutorial edits are practice: choosing a base starts one fresh mask.
    // Reuse the active volume instead of adding a second object to the table.
    item.volume.reset(shape, eyes);
    item.volume.undoStack = []; item.volume.redoStack = [];
    item.volume.userScale = 1;
    item.volume.userOffset = [0, 0];
    item.edited = false;
    item.shape = shape;
    item.label = `${MASK_SHAPES[shape].label} ${item.id}`;
    for (const other of [...clayObjects.items]) {
      if (other === item) continue;
      clayObjects.select(other.id);
      clayObjects.removeActive();
    }
    clayObjects.select(item.id);
    clayObjects.layout(camera);
    selectClayObject(item.id);
    editingPaused = false;
    setPrompt('Your canvas is ready.', 'Pinch to shape it, or choose a tool. Make it yours.', 'success');
  },
});

studioTutorial = new StudioTutorial({
  getControlMode: () => controlMode,
  onPrepare: async (recipe,phase) => {
    if(phase==='shape') {
      let item=clayObjects.active;
      if(item.edited) {
        item=clayObjects.add(recipe.shape,recipe.maskColour);
        if(!item)throw new Error('Remove a saved mask to try a new recipe.');
      } else item.volume.reset(recipe.shape,'oval');
      item.material.color.set(recipe.maskColour);
      item.shape=recipe.shape;item.label=`${recipe.shapeLabel} ${item.id}`;
      item.volume.undoStack=[];item.volume.redoStack=[];
      item.volume.userScale=1;item.volume.userOffset=[0,0];
      clayObjects.layout(camera);selectClayObject(item.id);
    } else {
      clayVolume.setEyeShape(recipe.eyes);
      clayMenu?.refresh();
    }
  },
  onFinish: reason => {
    if (reason === 'skip') { maskShapePicker.open(); return; }
    setPrompt('Made by you.', 'Your mask is yours to keep shaping. Undo lets you experiment.', 'success');
  },
  onTryOn: () => tryButton.click(),
  locate: target => {
    const local = new THREE.Vector3(...target);
    const world = clay.localToWorld(local);
    const projected = world.project(camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const host = sceneHost.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
    return { x: host.left - stage.left + (projected.x + 1) * host.width / 2,
      y: host.top - stage.top + (1 - projected.y) * host.height / 2 };
  },
  stage: document.querySelector('#stage'),
  isBusy: () => Boolean(previousPullPoint || cutStroke || twoHandScale.active || palmMove.active
    || clayVolume.surfacePaint?.active || clayVolume.surfaceExtrude?.active || clayVolume.surfaceErase?.active
    || clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending),
  isApplying: () => tutorialApplying(clayVolume),
  onStep: (tool, mission) => {
    if (handUI.isOpen) handUI.close();
    if (tryOn.enabled) endTryOn();
    if (editingPaused) editingPaused = false;
    pauseForHandUI();
    if (tool) document.querySelector(`#tool-${tool}`).click();
    if (tool === 'pinch') {
      sizeInput.value = '22'; sizeInput.dispatchEvent(new Event('input'));
      strengthInput.value = '65'; strengthInput.dispatchEvent(new Event('input'));
    }
    if(tool==='paint')setPaintColor(studioTutorial.recipe.colour);
    if(tool==='erase' || tool==='paint' || tool==='extrude') {
      sizeInput.value=tool==='erase'?'12':tool==='paint'?'18':'24';
      sizeInput.dispatchEvent(new Event('input'));
    }
  },
});

selfie=new SelfieStudio({stage:document.querySelector('#stage'),prepare:()=>startTryOn(),onExit:()=>endTryOn(),onChange:()=>handUI?.sync()});

setupFullscreen(document.querySelector('#stage'), cancelMouseStroke, { controls: [cameraButton, mouseButton] });
scenePlaceholder.classList.add('is-hidden');
showToolInstructions();

resetButton.addEventListener('pointerdown', (event) => event.stopPropagation());
resetButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resetClay();
});

window.addEventListener('beforeunload', () => {
  selfie?.dispose();
  sculptSounds.dispose();
  for(const item of clayObjects.items)item.volume.surfacePaint?.finish();
  for (const item of clayObjects.items) item.volume.surfaceExtrude?.abort();
  for (const item of clayObjects.items) item.volume.surfaceCut?.abort();
  for (const item of clayObjects.items) item.volume.surfacePull?.abort();
  for (const item of clayObjects.items) item.volume.surfaceErase?.abort();
  for (const item of clayObjects.items) item.volume.erasePreview?.dispose();
  for (const item of clayObjects.items) item.volume.meshQueue?.dispose();
  stopCamera();
  cancelAnimationFrame(animationFrame);
});
document.addEventListener('clay-mesh-error', () => {
  setPrompt('Clay updates paused.', 'The background sculpting worker stopped. Reload the page to restart the studio.', 'warning');
});
document.addEventListener('mask-pull-error', () => {
  cancelMouseStroke();
  setPrompt('This pull could not finish.', 'Your previous mask is being restored. Try again when the green ring returns.', 'warning');
});
document.addEventListener('sculpt-save-pending',()=>{
  sceneHint.textContent='Finishing your edit · keeping the preview until the surface is ready';
});

// Opt-in local inspection for replaying landmark traces and comparing field
// and mesh state. Camera data is never retained or transmitted by this hook.
window.clayPlayTrackingReport=()=>JSON.stringify({diagnostics,...trackingTrace.report()},null,2);
sceneHint.hidden = true;
comfortSetup.open(() => Boolean(stream && landmarker));
if (new URLSearchParams(location.search).has('diagnostics')) {
  window.clayPlayDebug = { objects: clayObjects, camera, tryOn,
    feedHands: (hands, now, { sampleAt = now, handedness } = {}) => processHandResult({ landmarks: hands, handedness }, now, sampleAt),
    setControlMode, feedHand: updateThreeSkeleton, pauseHand: pauseTracking, cancel: cancelMouseStroke,
    getState: () => ({ arEnabled: arView.enabled, arLive: arView.live, cameraOn: Boolean(stream),
      trying: tryOn.enabled, wearing: tryOn.mask.visible, faceReady: Boolean(faceTracker), cursorEnabled: cursorInputEnabled(),
      handMenuOpen: handUI.isOpen, handMenuPage: handUI.page, handUICaptured, editingPaused,
      resizeEnabled, resizeAutoPaused, singleHandNeedsOpen, resizing: twoHandScale.active, maskScale: clayVolume.userScale ?? 1,
      moving: palmMove.active, moveIntent, maskPosition: clay.position.toArray(), maskOffset: [...(clayVolume.userOffset ?? [0, 0])],
      handCount: landmarker?.handCount ?? 1, trackingInterval: landmarker?.minInterval ?? 0,
      virtualHandVisible: handModel.visible, tool: activeTool, cutting: Boolean(clayVolume.cutting), cutPoints: cutStroke?.points.length ?? 0,
      cutPreview: cutPreview.visible, pulling: Boolean(clayVolume.pulling), pending: Boolean(clayVolume.meshQueue?.pending),
      erasing: Boolean(clayVolume.erasing), eraseHeld: Boolean(clayVolume.surfaceErase?.active && !clayVolume.surfaceErase?.released), eraseCircle: activeTool === 'erase' && brushCue.visible,
      symmetry: symmetryEnabled, brushSize: activeSize, brushRadius: brushRadius(), hoverRadius: brushCue.visible ? brushCue.scale.x / clay.scale.x : 0,
      controlMode, palmPhase:palmControlState?.phase, held: pinchGesture.held, grabbed: Boolean(previousPullPoint), undo: clayVolume.undoStack?.length ?? 0,
      redo: clayVolume.redoStack?.length ?? 0, anchor: previousPullPoint?.toArray(), ...diagnostics }) };
}
