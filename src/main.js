import * as THREE from 'three';
import { ClayObjects } from './clayObjects.js';
import { setupClayMenu } from './clayMenu.js';
import { ReachCalibration } from './reachCalibration.js';
import { setupFullscreen } from './fullscreen.js';
import './style.css';
import { TrackingClient } from './trackingClient.js';
import { PinchGesture } from './pinchGesture.js';
import { diagnostics } from './diagnostics.js';
import { SurfacePull } from './surfacePull.js';
import { SurfaceCut } from './surfaceCut.js';
import { checkpoint, restoreHistory } from './sculptHistory.js';
import { CameraBackdrop, cameraCoverPoint } from './arView.js';
import { MaskTryOn } from './tryOn.js';

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
const scenePlaceholder = document.querySelector('#scene-placeholder');
const stageCaption = document.querySelector('#stage-caption');
const cameraStatus = document.querySelector('#camera-status');
const videoPlaceholder = document.querySelector('#video-placeholder');
const videoLive = document.querySelector('#video-live');
const tipHeading = document.querySelector('#tip-heading');
const tipCopy = document.querySelector('#tip-copy');
const landmarkCount = document.querySelector('#landmark-count');
const resetButton = document.querySelector('#clay-reset');
const undoButton = document.querySelector('#sculpt-undo');
const redoButton = document.querySelector('#sculpt-redo');
const toolButtons = [...document.querySelectorAll('[data-tool]')];
const strengthInput = document.querySelector('#tool-strength');
const strengthValue = document.querySelector('#strength-value');
const strengthContext = document.querySelector('#strength-context');
const sizeInput = document.querySelector('#tool-size');
const sizeValue = document.querySelector('#size-value');
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
let poseTarget = null;
let poseDisplayed = null;
let poseReceivedAt = 0;
let gapStartedAt = null;
let previousRenderAt = performance.now();
let trackingEpoch = 0;
let nextTrackingAt = 0;
let stream;
let cameraOpening = false;
let cameraStartup;
let cameraRequestEpoch = 0;
let arStartedCamera = false;
let arAction = 0;
let faceTracker, faceAbort, faceFrame;
let faceEpoch = 0, lastFaceVideoTime = -1, nextFaceTrackingAt = 0;
let tryPreviousAR = false, tryPreviousMouse = false, tryStartedCamera = false;
let tryHandWasDone = false;
let tryPhase = null;
let landmarker;
let animationFrame = 0;
let lastVideoTime = -1;
let lastHandAt = 0;
let noHandSince = 0;
let wasTracking = false;
let smoothedPoints = null;
let videoWidth = 0;
let videoHeight = 0;
let retryTimer;
let mouseMode = false;
let mousePinching = false;
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
scene.background = new THREE.Color('#eadfd2');
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
    if (tryOn.enabled && !arView.enabled) endTryOn({ restoreView: false });
    cancelMouseStroke(); poseTarget = null; poseDisplayed = null; smoothedPoints = null;
    sceneHost.setAttribute('aria-label', arView.live ? 'Camera view with editable mask' : 'Three dimensional hand tracking view');
  },
  onError: () => setPrompt('Camera view could not start.', 'The studio is ready. Try AR mode again to show the camera behind your mask.', 'warning'),
});
arButton.addEventListener('pointerdown', event => event.stopPropagation());
arButton.addEventListener('click', async () => {
  if (tryOn.enabled) endTryOn({ restoreView: false });
  const action = ++arAction;
  cancelMouseStroke();
  const enabled = !arView.enabled;
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
    mouseButton.textContent = 'Preview with mouse';
    document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
    await startCamera();
    if (action === arAction) arStartedCamera = false;
  }
  if (arView.live && !tryOn.enabled) sceneHint.textContent = 'AR mode on · point at the mask to shape or cut';
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
tryButton.addEventListener('click', async () => {
  if (tryOn.enabled) { endTryOn(); return; }
  if (clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending) {
    sceneHint.textContent = 'Finishing your mask · try it in a moment'; return;
  }
  tryPreviousAR = arView.enabled; tryPreviousMouse = mouseMode;
  tryStartedCamera = !stream && !cameraOpening;
  cancelMouseStroke(); trackingEpoch++; cancelAnimationFrame(retryTimer);
  poseTarget = null; poseDisplayed = null; handModel.visible = false; clearPreview();
  mouseMode = false; tryOn.setEnabled(true);
  tryPhase = null;
  const epoch = ++faceEpoch;
  faceAbort = new AbortController(); const signal = faceAbort.signal;
  document.querySelector('#stage').classList.add('is-trying');
  document.querySelector('#session-label').textContent = 'TRY IT';
  const handCheck = document.querySelector('#check-hand');
  tryHandWasDone = handCheck.classList.contains('is-done');
  handCheck.children[1].textContent = 'Show your face'; handCheck.classList.remove('is-done');
  tryButton.setAttribute('aria-pressed', 'true'); tryButton.classList.add('is-active');
  cameraButton.hidden = false; mouseButton.textContent = 'Preview with mouse';
  arView.setEnabled(true);
  try {
    if (stream) await arView.attachStream(stream); else await startCamera();
    if (epoch !== faceEpoch || !tryOn.enabled) return;
    if (!stream || !arView.live) throw new Error('Camera view is unavailable');
    const tracker = await TrackingClient.create('face', signal);
    if (epoch !== faceEpoch || !tryOn.enabled) { tracker.close(); return; }
    faceTracker = tracker; lastFaceVideoTime = -1; nextFaceTrackingAt = 0;
    cameraButton.disabled = false; buttonLabel.textContent = 'Camera on';
    faceTrackingLoop(epoch);
  } catch (error) {
    if (epoch !== faceEpoch || !tryOn.enabled) return;
    console.warn('Mask try-on could not start:', error);
    endTryOn();
    setPrompt('Try it could not start.', 'Face tracking could not load. Check your connection and try again; your mask is ready to keep creating.', 'warning');
  }
});

function endTryOn({ restoreView = true, resumeTracking = true } = {}) {
  if (!tryOn.enabled) return;
  faceEpoch++; faceAbort?.abort(); faceTracker?.close(); faceTracker = null;
  cancelAnimationFrame(faceFrame); tryOn.setEnabled(false);
  document.querySelector('#stage').classList.remove('is-trying');
  tryButton.setAttribute('aria-pressed', 'false'); tryButton.classList.remove('is-active');
  tryButton.querySelector('.try-state').textContent = 'Off';
  mouseMode = tryPreviousMouse; poseTarget = null; poseDisplayed = null; smoothedPoints = null; gapStartedAt = null;
  mouseButton.textContent = mouseMode ? 'Exit mouse sculpting' : 'Preview with mouse';
  mouseButton.hidden = !mouseMode && Boolean(stream && landmarker);
  document.querySelector('#session-label').textContent = mouseMode ? 'MOUSE MODE' : 'YOUR FIRST SESSION';
  const handCheck = document.querySelector('#check-hand');
  handCheck.children[1].textContent = 'Show one hand'; handCheck.classList.toggle('is-done', tryHandWasDone);
  sceneHost.setAttribute('aria-label', arView.live ? 'Camera view with editable mask' : 'Three dimensional hand tracking view');
  resetToolControls();
  if (restoreView) arView.setEnabled(tryPreviousAR);
  if (tryStartedCamera && cameraOpening) { tryStartedCamera = false; stopCamera(); return; }
  tryStartedCamera = false;
  if (resumeTracking && stream && !mouseMode) {
    if (landmarker) trackingLoop(); else startTracking();
  }
}

async function faceTrackingLoop(epoch) {
  const tracker = faceTracker;
  if (!tryOn.enabled || !stream || !tracker || epoch !== faceEpoch) return;
  try {
    const now = performance.now();
    if (now >= nextFaceTrackingAt && video.readyState >= 2 && video.currentTime !== lastFaceVideoTime) {
      lastFaceVideoTime = video.currentTime; nextFaceTrackingAt = now + (tracker.minInterval ?? 33);
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
const brushCue = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos(i / 48 * Math.PI * 2), Math.sin(i / 48 * Math.PI * 2), 0))),
  new THREE.LineBasicMaterial({ color: '#538c68', transparent: true, opacity: 0.85, depthTest: false }),
);
brushCue.visible = false; brushCue.renderOrder = 6; scene.add(brushCue);
const grabTether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: '#538c68', depthTest: false, transparent: true, opacity: 0.8 }));
grabTether.visible = false; grabTether.renderOrder = 6; scene.add(grabTether);
const mirroredBrush = brushCue.clone();
mirroredBrush.material = brushCue.material.clone();
mirroredBrush.material.opacity = 0.55;
mirroredBrush.visible = false; scene.add(mirroredBrush);
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
document.querySelector('#restart-reach').addEventListener('click', () => { cancelMouseStroke(); reachCalibration.reset(); });

function resetClay() {
  if (tryOn.enabled) return;
  if (clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending) return;
  cancelMouseStroke();
  checkpoint(clayVolume);
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
  setPrompt('Fresh mask, ready to shape.', toolDetails().body, 'success');
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
    });
    // Save one reversible action, then deform the same original patch on every
    // update. No resampling or old path backlog runs in the drawing loop.
    checkpoint(volume);
    if (!volume.surfacePull.begin(currentPoint, brushRadius(), activeStrength / 100, symmetryEnabled)) return;
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
  if (previousPullCursorPoint && cursor.distanceTo(previousPullCursorPoint) < 0.003) return;
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

function renderScene() {
  arView.update();
  const now = performance.now();
  diagnostics.poseAgeMs = poseTarget ? now - poseReceivedAt : 0;
  const dt = Math.min(0.05, (now - previousRenderAt) / 1000);
  diagnostics.frameMs = now - previousRenderAt;
  previousRenderAt = now;
  if (!tryOn.enabled && !mouseMode && poseTarget && gapStartedAt === null && now - poseReceivedAt < 200) {
    poseDisplayed ??= poseTarget.map((p) => p.clone());
    // One short render interpolation shared by the visible hand and tools.
    const blend = 1 - Math.exp(-dt / 0.012);
    poseDisplayed.forEach((p, i) => p.lerp(poseTarget[i], blend));
    processHandPose(poseDisplayed, pinchGesture.held);
  } else if (!tryOn.enabled && !mouseMode && poseTarget && now - poseReceivedAt >= 200) {
    pauseTracking(now);
  }
  depthGuide.hidden = true;
  symmetryGuide.visible = symmetryEnabled && !tryOn.enabled;
  if (symmetryEnabled) {
    const radius = { full: 1.4, half: 0.75, animal: 1.8 }[clayVolume.shape];
    symmetryGuide.position.copy(clay.localToWorld(new THREE.Vector3(0, 0, 0.9)));
    symmetryGuide.scale.setScalar(radius * clay.scale.x);
  }
  mirroredBrush.visible = activeTool === 'pinch' && symmetryEnabled && (brushCue.visible || Boolean(previousPullPoint && pinchActive));
  if (mirroredBrush.visible) {
    const point = previousPullPoint?.clone() ?? clay.worldToLocal(brushCue.position.clone());
    point.x = -point.x;
    mirroredBrush.position.copy(clay.localToWorld(point)); mirroredBrush.position.z += 0.035;
    mirroredBrush.scale.setScalar(brushRadius() * clay.scale.x);
  }
  if (arView.live) handModel.visible = false;
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
  updateHistoryButtons();
  animationFrame = requestAnimationFrame(renderScene);
}
renderScene();

function setStatus(state, label) {
  if (statusPill.dataset.state === state && trackingText.textContent === label) return;
  statusPill.dataset.state = state;
  trackingText.textContent = label;
}

function setPrompt(title, body, tone = 'neutral') {
  if (promptTitle.textContent !== title) promptTitle.textContent = title;
  if (promptBody.textContent !== body) promptBody.textContent = body;
  if (promptCard.dataset.tone !== tone) promptCard.dataset.tone = tone;
}

const pinchDetails = {
    context: 'Patch softness',
    caption: 'PINCH TOOL · PINCH TO SHAPE',
    hint: '<span class="hint-icon">✦</span> Point at the mask · pinch · drag · release',
    mouseHint: 'Click a highlighted patch and drag; release to keep it',
    mouseCaption: 'PINCH TOOL · CLICK AND DRAG TO PULL',
    title: 'Point, pinch, and drag.',
    body: 'Aim at the mask until the green ring appears. Pinch and drag to shape it; release to keep it. No reach calibration needed for this tool.',
    tipHeading: 'Pinch to shape',
    tipCopy: 'Green ring means ready. Pinch to grab, drag to reshape, and release. Undo is always nearby.',
};

const cutDetails = {
  context: 'Fixed fine cut', caption: 'CUT · PINCH, TRACE, RELEASE',
  hint: '<span class="hint-icon">✦</span> Pinch · trace edge to edge or a loop · release',
  mouseHint: 'Click and trace edge to edge or a closed loop; release to cut',
  mouseCaption: 'CUT · CLICK, TRACE, RELEASE', title: 'Trace a cut.',
  body: 'Pinch to start. Trace with your index from one edge to another, or draw a closed loop. Release: the smaller piece disappears. Undo brings it back.',
  tipHeading: 'Cut with your index', tipCopy: 'Follow the red line. Reach both edges or close your loop, then release. The smaller piece disappears.',
};
function toolDetails() { return activeTool === 'cut' ? cutDetails : pinchDetails; }

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
  const waiting = Boolean(tryOn.enabled || clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending);
  undoButton.disabled = waiting || !clayVolume.undoStack?.length;
  redoButton.disabled = waiting || !clayVolume.redoStack?.length;
  resetButton.disabled = waiting;
}

function useHistory(redo = false) {
  if (tryOn.enabled) return;
  if (clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending) return;
  cancelMouseStroke();
  if (!restoreHistory(clayVolume, redo)) return;
  markClayEdited();
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
  tryPhase = null;
  cutStroke = null; cutPreview.visible = false; mirroredCutPreview.visible = false;
  clayVolume.surfacePull?.finish();
  brushCue.visible = false; grabTether.visible = false;
  grabCursorOrigin = null; grabAnchor = null;
  pinchGesture.reset();
  const details = toolDetails();
  strengthInput.disabled = tryOn.enabled || activeTool === 'cut'; sizeInput.disabled = tryOn.enabled || activeTool === 'cut';
  document.querySelector('#size-context').textContent = activeTool === 'cut' ? 'Cut follows your index' : 'Brush width · % of starting shape';
  toolButtons.forEach(button => {
    const selected = button.dataset.tool === activeTool;
    button.classList.toggle('is-active', selected); button.setAttribute('aria-pressed', String(selected));
  });
  updateStrengthControl();
  pinchActive = false;
  pinchHasContact = false;
  previousPullPoint = null;
  pinchCue.visible = false;
  stageCaption.textContent = mouseMode ? details.mouseCaption : details.caption;
  sceneHint.innerHTML = mouseMode ? `<span class="hint-icon">✦</span> ${details.mouseHint}` : details.hint;
  setPrompt(mouseMode ? 'Mouse sculpting is ready.' : details.title, mouseMode ? `${details.mouseHint}.${activeTool === 'pinch' ? ` Adjust ${details.context.toLowerCase()} above.` : ' The smaller piece disappears; Undo brings it back.'}` : details.body, 'success');
  tipHeading.textContent = details.tipHeading;
  tipCopy.textContent = details.tipCopy;
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

function drawPreviewSkeleton(landmarks) {
  if (!video.videoWidth) return;
  const width = previewCanvas.clientWidth;
  const height = previewCanvas.clientHeight;
  if (previewCanvas.width !== Math.round(width * devicePixelRatio) || previewCanvas.height !== Math.round(height * devicePixelRatio)) {
    previewCanvas.width = Math.round(width * devicePixelRatio);
    previewCanvas.height = Math.round(height * devicePixelRatio);
  }
  previewContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  clearPreview();
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

function updateThreeSkeleton(landmarks, now, pinchOverride = null, worldLandmarks = null, handedness = '') {
  if (!smoothedPoints || smoothedPoints.length !== landmarks.length) {
    smoothedPoints = landmarks.map(({ x, y, z }) => ({ x, y, z }));
  } else {
    const elapsed = Math.min((now - (window.lastSmoothTime || now - 16)) / 1000, 0.1);
    const alpha = 1 - Math.exp(-40 * elapsed);
    landmarks.forEach((point, index) => {
      smoothedPoints[index].x += (point.x - smoothedPoints[index].x) * alpha;
      smoothedPoints[index].y += (point.y - smoothedPoints[index].y) * alpha;
      smoothedPoints[index].z += (point.z - smoothedPoints[index].z) * alpha;
    });
  }
  window.lastSmoothTime = now;
  const scaleX = 4.8;
  const scaleY = Math.min(4.8 * (sceneHost.clientHeight / sceneHost.clientWidth), 3.5);
  const arHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  // Image-space landmarks already carry camera perspective: nearer hands occupy more pixels.
  // MediaPipe landmark Z is relative to the wrist, not a global camera-distance value.
  const pointAt = (point) => {
    if (arView.live && !mouseMode) {
      const mapped = cameraCoverPoint(point, video.videoWidth, video.videoHeight, sceneHost.clientWidth, sceneHost.clientHeight);
      return { x: (mapped.x - 0.5) * arHeight * camera.aspect, y: (0.5 - mapped.y) * arHeight, z: 0 };
    }
    return {
      x: (0.5 - point.x) * scaleX,
      y: (0.5 - point.y) * scaleY,
      // MediaPipe depth gets smaller toward the camera; Three.js uses +Z.
      z: -point.z * 2.3,
    };
  };
  let mappedPoints = smoothedPoints.map(pointAt);
  if (!mouseMode) {
    // Screen-space aim is usable immediately, independently of approximate
    // webcam depth. Freeze edits during missing frames but keep a brief grab.
    if (gapStartedAt !== null) {
      const midpointShift = poseTarget ? new THREE.Vector3(mappedPoints[8].x, mappedPoints[8].y, mappedPoints[8].z).distanceTo(poseTarget[8]) : 0;
      if (now - gapStartedAt > 700 || midpointShift > (activeTool === 'cut' ? 0.2 : 1.2)) cancelMouseStroke();
      grabCursorOrigin = null; previousPullCursorPoint = null;
      gapStartedAt = null; poseDisplayed = null;
    }
    pinchGesture.update(landmarks, now, video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1);
    poseTarget = mappedPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
    poseReceivedAt = now;
    reachCalibration.panel.open = false;
    depthGuide.hidden = true;
    return;
  }
  processHandPose(mappedPoints, pinchOverride);
}

function processCut(handPoint, held, wasHeld) {
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
    stageCaption.textContent = 'CUT OUTLINE · FOLLOW YOUR INDEX'; lastPinchHint = true;
  } else if (!held && cutStroke) {
    const stroke = cutStroke; cutStroke = null;
    cutPreview.visible = false; mirroredCutPreview.visible = false;
    if (stroke.points.length < 2 || stroke.length < 0.12) {
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
    contactLabel.textContent = 'Pinch to start a cut';
  }
}

function processHandPose(mappedPoints, pinchOverride = null) {
  if (tryOn.enabled) return;
  // In mouse preview, align the sculpting fingertip/grab with the actual cursor.
  if (mouseMode && mouseSculptPoint) {
    const anchor = mappedPoints[8];
    const offset = new THREE.Vector3().subVectors(mouseSculptPoint, anchor);
    mappedPoints.forEach((point) => { point.x += offset.x; point.y += offset.y; });
  }
  handModel.position.z = mouseMode ? 1.3 : 0;
  updateHandSurface(mappedPoints);
  if (arView.live) handModel.visible = false;
  scenePlaceholder.classList.add('is-hidden');
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
  if (volumeBusy()) return;
  if (activeSize === 0 && activeTool === 'pinch') {
    brushCue.visible = false; contactCue.visible = false; pinchCue.visible = false;
    contactLabel.textContent = 'Brush off · increase Size';
    sceneHint.textContent = 'Size is 0% · increase Size to sculpt';
    setPrompt('Brush is off.', 'Increase Size above 0% to sculpt the mask.', 'neutral');
    return;
  }
  const pinchDistance = new THREE.Vector3().subVectors(mappedPoints[4], mappedPoints[8]).length();
  const palmWidth = Math.max(0.04, new THREE.Vector3().subVectors(mappedPoints[5], mappedPoints[17]).length());
  const pinchRatio = pinchDistance / palmWidth;
  const wasPinching = pinchActive;
  if (pinchOverride !== null) pinchActive = pinchOverride;
  else if (!pinchActive && pinchRatio < 0.34) pinchActive = true;
  else if (pinchActive && pinchRatio > 0.48) pinchActive = false;

  const index = mappedPoints[8];
  const sculptPoint = new THREE.Vector3(index.x, index.y, mouseMode ? 0 : index.z);
  if (activeTool === 'cut') {
    processCut(sculptPoint, pinchActive, wasPinching);
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
    if (!surfaceHit && pinchActive && !wasPinching && recentGrabHit && now - recentGrabAt < 220
      && Math.hypot(recentGrabHit.worldPoint.x - sculptPoint.x, recentGrabHit.worldPoint.y - sculptPoint.y) < 0.2) surfaceHit = recentGrabHit;
  }
  const contact = surfaceHit;
  contactCue.visible = !mouseMode && Boolean(contact) && activeSize > 0;
  contactCue.scale.setScalar(Math.min(1, brushRadius() * clay.scale.x / 0.065 * 0.3));
  if (contactCue.visible) contactCue.position.copy(contact.worldPoint);
  contactLabel.textContent = previousPullPoint && pinchActive ? 'Patch grabbed · drag to reshape' : contact ? 'Ready to grab' : 'Point at the mask';
  brushCue.visible = Boolean(contact) && !previousPullPoint && activeSize > 0;
  if (brushCue.visible) {
    brushCue.position.copy(contact.worldPoint); brushCue.position.z += 0.035;
    brushCue.scale.setScalar(brushRadius() * clay.scale.x);
    brushCue.material.color.set(clayVolume.meshQueue?.pending ? '#be914b' : '#538c68');
  }
  diagnostics.pinch = pinchActive ? 'held' : 'open';
  diagnostics.pause = 'none';
  contactLabel.dataset.contact = String(Boolean(contact));
  const sculptStartedAt = performance.now();
  pullClayAlongPath(sculptPoint, pinchActive, surfaceHit?.point ?? null);
  if (previousPullPoint) {
    pinchCue.position.copy(clay.localToWorld(previousPullPoint.clone()));
    pinchCue.position.z += 0.09;
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
        setPrompt('You have the patch.', 'Keep your fingers pinched and move your hand. The patch follows your drag. Open your fingers to release; Undo reverses the change.', 'success');
      } else {
        stageCaption.textContent = 'PINCH ACTIVE · FIND THE CLAY';
        sceneHint.textContent = clayVolume.pulling || clayVolume.meshQueue?.pending ? 'Finishing the last change · keep your hand in view' : 'Point at a solid patch until the green ring appears';
        setPrompt('Find a patch.', 'Aim at the visible mask surface. Eye openings have no material to grab.', 'neutral');
      }
    } else {
      if (pinchHasContact) {
        stageCaption.textContent = 'RELEASED · READY FOR ANOTHER PATCH';
        sceneHint.textContent = 'Released · point at another patch or Undo';
        setPrompt('Released.', 'Check your shape. Undo reverses the last change; pinch another patch to keep creating.', 'success');
      } else {
        stageCaption.textContent = 'HAND TRACKED · PINCH TO SHAPE';
        sceneHint.innerHTML = '<span class="hint-icon">✦</span> Pinch over the clay, then pull';
        setPrompt(pinchDetails.title, pinchDetails.body, 'success');
      }
    }
  }
  pinchHasContact = hasPinchContact;
}

function showTracking(landmarks, now, worldLandmarks, handedness) {
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
  updateThreeSkeleton(landmarks, now, null, worldLandmarks, handedness);
  drawPreviewSkeleton(smoothedPoints ?? landmarks);
}

function pauseTracking(now) {
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

function showNoHand(now) {
  pauseTracking(now);
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

async function trackingLoop(epoch = trackingEpoch) {
  const tracker = landmarker;
  if (!stream || !tracker || epoch !== trackingEpoch) return;
  let phase = 'frame capture / inference';
  try {
    if (performance.now() >= nextTrackingAt && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const capturedAt = performance.now();
      nextTrackingAt = capturedAt + (tracker.minInterval ?? 0);
      const result = await tracker.detectForVideo(video, capturedAt);
      if (epoch !== trackingEpoch || tracker !== landmarker || !stream) return;
      diagnostics.inferenceMs = tracker.duration;
      diagnostics.resultAgeMs = performance.now() - capturedAt;
      phase = 'landmark processing';
      // Never sculpt using an old result after a long inference stall.
      if (performance.now() - capturedAt > 250) showNoHand(performance.now());
      else if (result.landmarks?.length) showTracking(result.landmarks[0], performance.now(), result.worldLandmarks?.[0], result.handedness?.[0]?.[0]?.categoryName ?? '');
      else showNoHand(performance.now());
    }
  } catch (error) {
    if (epoch !== trackingEpoch || tracker !== landmarker) return;
    console.error('Tracking interrupted:', error);
    showNoHand(performance.now());
    cancelMouseStroke();
    const detail = `${tracker.mode ?? 'unknown'} · ${phase}: ${error.name ?? 'Error'}: ${error.message ?? String(error)}`;
    diagnostics.lastError = detail;
    diagnostics.pause = 'tracking error';
    try { tracker.close(); } catch (closeError) { console.warn('Tracking cleanup:', closeError); }
    landmarker = null;
    poseTarget = null;
    poseDisplayed = null;
    handModel.visible = false;
    if (tracker.mode === 'worker' && phase === 'frame capture / inference') {
      setStatus('loading', 'RECONNECTING TRACKING');
      buttonLabel.textContent = 'Reconnecting…';
      cameraButton.disabled = true;
      setPrompt('Reconnecting hand tracking…', 'Background tracking stopped responding. Switching to compatibility mode; keep your hand in view.', 'neutral');
      try {
        const replacement = await TrackingClient.createCompatibility();
        if (epoch !== trackingEpoch || !stream) { replacement.close(); return; }
        landmarker = replacement;
        diagnostics.trackingMode = replacement.mode;
        diagnostics.pause = 'none';
        nextTrackingAt = 0;
        lastVideoTime = -1;
        gapStartedAt = null;
        reachCalibration.reset();
        cameraButton.disabled = false;
        buttonLabel.textContent = 'Camera on';
        setStatus('searching', 'LOOKING FOR HAND');
        setPrompt('Tracking reconnected.', 'Show an open palm, then calibrate your reach. Compatibility mode is active.', 'success');
        retryTimer = requestAnimationFrame(() => trackingLoop(epoch));
        return;
      } catch (recoveryError) {
        if (epoch !== trackingEpoch || !stream) return;
        diagnostics.lastError = `${detail}; recovery: ${recoveryError.message}`;
        console.error('Tracking recovery failed:', recoveryError);
      }
    }
    setStatus('error', 'TRACKING ERROR');
    stageCaption.textContent = 'TRACKING STOPPED';
    landmarkCount.textContent = 'TRACKING ERROR · CAMERA STILL ON';
    buttonLabel.textContent = 'Retry tracking';
    cameraButton.disabled = false;
    mouseButton.hidden = false;
    setPrompt('Tracking stopped — error details', `${diagnostics.lastError}. Use Retry tracking to reconnect.`, 'warning');
    tipHeading.textContent = 'The camera is working.';
    tipCopy.textContent = 'Tracking stopped because of a software error. See the error details below the play area.';
    return;
  }
  if (epoch === trackingEpoch && stream) retryTimer = requestAnimationFrame(() => trackingLoop(epoch));
}

async function createLandmarker() { return TrackingClient.create(); }

async function startTracking() {
  if (tryOn.enabled) return;
  cameraButton.disabled = true;
  buttonLabel.textContent = 'Loading tracking…';
  setStatus('loading', 'SETTING UP');
  landmarkCount.textContent = '21 LANDMARKS · LOADING';
  const epoch = ++trackingEpoch;
  try {
    const tracker = await createLandmarker();
    if (epoch !== trackingEpoch || !stream) { tracker.close(); return; }
    landmarker?.close();
    landmarker = tracker;
    nextTrackingAt = 0;
    diagnostics.trackingMode = tracker.mode;
    buttonLabel.textContent = 'Camera on';
    cameraButton.classList.add('is-secondary');
    cameraButton.disabled = false;
    mouseButton.hidden = true;
    setPrompt('Camera’s ready. Show us one hand.', 'Hold your palm toward the camera, with your wrist in view.', 'success');
    trackingLoop();
  } catch (error) {
    if (epoch !== trackingEpoch || !stream) return;
    console.error('ClayPlay hand tracking setup failed:', error);
    cameraButton.disabled = false;
    buttonLabel.textContent = 'Retry tracking';
    mouseButton.hidden = false;
    setStatus('error', 'TRACKING UNAVAILABLE');
    landmarkCount.textContent = '21 LANDMARKS · OFFLINE';
    setPrompt('Your camera is on, but tracking didn’t load.', 'The tracking engine could not start in either mode. Retry tracking; if it still fails, check your connection and reload the page.', 'warning');
    tipHeading.textContent = 'The camera is still on.';
    tipCopy.textContent = 'Retry tracking, or use the mouse preview while the hand-tracking files load.';
  }
}

function startCamera() {
  if (cameraOpening) return cameraStartup;
  cameraStartup = openCamera();
  return cameraStartup;
}

async function openCamera() {
  cameraOpening = true;
  const requestEpoch = ++cameraRequestEpoch;
  cancelMouseStroke();
  mouseMode = false;
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
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    });
    if (requestEpoch !== cameraRequestEpoch) { openedStream.getTracks().forEach(track => track.stop()); return; }
    stream = openedStream;
    openedStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (stream === openedStream) { stopCamera(); setPrompt('Camera stopped.', 'Reconnect your camera, then turn AR mode on again.', 'neutral'); }
    });
    video.srcObject = stream;
    await video.play();
    if (requestEpoch !== cameraRequestEpoch) return;
    videoWidth = video.videoWidth;
    videoHeight = video.videoHeight;
    videoPlaceholder.hidden = true;
    videoLive.classList.add('is-visible');
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
    mouseButton.hidden = false;
    setStatus('error', 'CAMERA UNAVAILABLE');
    landmarkCount.textContent = '21 LANDMARKS · OFFLINE';
    const isPermission = error.name === 'NotAllowedError' || error.name === 'SecurityError';
    const isUnsupported = error.message === 'unsupported';
    setPrompt(isUnsupported ? 'This browser can’t open a camera here.' : isPermission ? 'Camera access is turned off.' : 'We couldn’t start the camera.', isUnsupported ? 'Open ClayPlay in a modern browser on localhost or a secure connection, or continue with mouse controls.' : isPermission ? 'Allow camera access in your browser’s address bar, then try again. You can also continue without it.' : 'Check that your camera is connected and not being used elsewhere, then try again.', 'warning');
    tipHeading.textContent = 'No camera? That’s okay.';
    tipCopy.textContent = 'You can still preview how a tracked hand moves through the studio.';
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
  endTryOn({ restoreView: false, resumeTracking: false });
  cameraRequestEpoch++; cameraOpening = false;
  arView.setEnabled(false);
  cancelMouseStroke();
  trackingEpoch++;
  poseTarget = null; poseDisplayed = null; gapStartedAt = null;
  pinchGesture.reset();
  reachCalibration.reset();
  contactCue.visible = false;
  pinchActive = false;
  pinchHasContact = false;
  mousePinching = false;
  pinchCue.visible = false;
  cancelAnimationFrame(retryTimer);
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  if (resetLandmarker && landmarker) {
    landmarker.close();
    landmarker = null;
  }
  cameraStatus.textContent = 'OFF';
  cameraStatus.classList.remove('is-on');
  videoLive.classList.remove('is-visible');
  videoPlaceholder.hidden = false;
  buttonLabel.textContent = 'Set up camera';
  cameraButton.classList.remove('is-secondary');
  cameraButton.disabled = false;
  if (resetLandmarker) {
    setStatus('idle', 'NOT CONNECTED');
    scenePlaceholder.classList.remove('is-hidden');
    handModel.visible = false;
    previousPullPoint = null;
    smoothedPoints = null;
    window.lastSmoothTime = 0;
    landmarkCount.textContent = '21 LANDMARKS · WAITING';
  }
}

cameraButton.addEventListener('click', () => {
  if (stream) {
    if (!landmarker && !tryOn.enabled && !mouseMode) {
      startTracking();
      return;
    }
    stopCamera();
    mouseButton.hidden = true;
    setPrompt('Camera paused.', 'Your camera is off. Start it again whenever you’re ready.');
  } else startCamera();
});

mouseButton.addEventListener('click', () => {
  if (mouseMode) {
    mouseMode = false;
    mouseButton.hidden = true;
    cameraButton.hidden = false;
    setStatus('idle', 'NOT CONNECTED');
    setPrompt('Ready when you are', 'We’ll use your camera to follow your hand. Video stays on this device.');
    stageCaption.textContent = 'YOUR HAND WILL APPEAR HERE';
    sceneHint.innerHTML = '<span class="hint-icon">↗</span> Keep your hand inside the frame';
    scenePlaceholder.classList.remove('is-hidden');
    handModel.visible = false;
    previousPullPoint = null;
    pinchActive = false;
    mousePinching = false;
    pinchCue.visible = false;
    document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
    mouseButton.textContent = 'Preview with mouse';
    return;
  }
  stopCamera();
  mouseMode = true;
  setStatus('ready', 'MOUSE SCULPTING');
  landmarkCount.textContent = '21 LANDMARKS · MOUSE';
  scenePlaceholder.classList.add('is-hidden');
  const details = toolDetails();
  stageCaption.textContent = details.mouseCaption;
  sceneHint.innerHTML = `<span class="hint-icon">✦</span> ${details.mouseHint}`;
  setPrompt('Mouse sculpting is ready.', `${details.mouseHint}.${activeTool === 'pinch' ? ` Adjust ${details.context.toLowerCase()} above.` : ' The smaller piece disappears; Undo brings it back.'}`, 'success');
  tipHeading.textContent = 'Camera optional';
  tipCopy.textContent = 'Drag across the clay, then release to let it settle.';
  mouseButton.textContent = 'Exit mouse sculpting';
  mouseButton.hidden = false;
  cameraButton.hidden = true;
  document.querySelector('#session-label').textContent = 'MOUSE MODE';
});

const handShape = [
  [0,0],[-.035,-.035],[-.075,-.085],[-.12,-.13],[-.17,-.17],
  [-.075,-.055],[-.09,-.12],[-.105,-.19],[-.115,-.26],
  [-.025,-.075],[-.025,-.16],[-.025,-.245],[-.02,-.32],
  [.035,-.06],[.05,-.14],[.065,-.22],[.075,-.29],
  [.09,-.035],[.12,-.105],[.145,-.17],[.165,-.23],
];
function updateMouseTarget(event) {
  const bounds = sceneHost.getBoundingClientRect();
  clayRaycaster.setFromCamera(new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    1 - ((event.clientY - bounds.top) / bounds.height) * 2,
  ), camera);
  mouseSculptPoint = clayRaycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
}

sceneHost.addEventListener('pointermove', (event) => {
  if (!mouseMode) return;
  updateMouseTarget(event);
  const bounds = sceneHost.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  const size = Math.min(bounds.width, bounds.height) / bounds.width;
  const landmarks = handShape.map(([offsetX, offsetY]) => ({
    x: Math.max(0.02, Math.min(0.98, x + offsetX * size)),
    y: Math.max(0.02, Math.min(0.98, y + offsetY * size)),
    z: 0,
  }));
  updateThreeSkeleton(landmarks, performance.now(), mousePinching);
});

sceneHost.addEventListener('pointerdown', (event) => {
  if (tryOn.enabled) return;
  if (event.target !== renderer.domElement || event.button !== 0) return;
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
  if (!mouseMode) return;
  cancelMouseStroke();
  smoothedPoints = null;
  mousePinching = true;
  sceneHost.setPointerCapture(event.pointerId);
  const bounds = sceneHost.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  const size = Math.min(bounds.width, bounds.height) / bounds.width;
  const landmarks = handShape.map(([offsetX, offsetY]) => ({ x: Math.max(0.02, Math.min(0.98, x + offsetX * size)), y: Math.max(0.02, Math.min(0.98, y + offsetY * size)), z: 0 }));
  updateThreeSkeleton(landmarks, performance.now(), true);
});

sceneHost.addEventListener('pointerup', (event) => {
  if (!mouseMode || !mousePinching) return;
  updateMouseTarget(event);
  mousePinching = false;
  const bounds = sceneHost.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  const size = Math.min(bounds.width, bounds.height) / bounds.width;
  const landmarks = handShape.map(([offsetX, offsetY]) => ({ x: Math.max(0.02, Math.min(0.98, x + offsetX * size)), y: Math.max(0.02, Math.min(0.98, y + offsetY * size)), z: 0 }));
  updateThreeSkeleton(landmarks, performance.now(), false);
});

function cancelMouseStroke() {
  cutStroke = null; cutPreview.visible = false; mirroredCutPreview.visible = false;
  recentGrabHit = null;
  clayVolume.surfacePull?.finish();
  brushCue.visible = false; grabTether.visible = false;
  grabCursorOrigin = null; grabAnchor = null;
  pinchGesture.reset();
  contactCue.visible = false;
  contactLabel.dataset.contact = 'false';
  contactLabel.textContent = 'Point at the mask';
  mousePinching = false;
  pinchActive = false;
  pinchHasContact = false;
  pinchCue.visible = false;
  previousPullPoint = null;
  previousPullCursorPoint = null;
}
function volumeBusy() {
  if (clayVolume.cutting) { contactLabel.textContent = 'Finishing your cut…'; return true; }
  if (clayVolume.pulling && !previousPullPoint) {
    contactLabel.textContent = 'Keeping your change…'; return true;
  }
  return false;
}
sceneHost.addEventListener('pointercancel', cancelMouseStroke);
sceneHost.addEventListener('lostpointercapture', cancelMouseStroke);

clayMenu = setupClayMenu(clayObjects, {
  onSelect: selectClayObject,
  onLayout: () => { cancelMouseStroke(); clayObjects.layout(camera); },
  onPause: (open) => { cancelMouseStroke(); if (open) reachCalibration.panel.open = false; },
});

setupFullscreen(document.querySelector('#stage'), cancelMouseStroke);

resetButton.addEventListener('pointerdown', (event) => event.stopPropagation());
resetButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resetClay();
});

window.addEventListener('beforeunload', () => {
  for (const item of clayObjects.items) item.volume.surfaceCut?.abort();
  for (const item of clayObjects.items) item.volume.surfacePull?.abort();
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

// Opt-in local inspection for replaying landmark traces and comparing field
// and mesh state. Camera data is never retained or transmitted by this hook.
if (new URLSearchParams(location.search).has('diagnostics')) {
  window.clayPlayDebug = { objects: clayObjects, camera, tryOn,
    feedHand: updateThreeSkeleton, pauseHand: pauseTracking, cancel: cancelMouseStroke,
    getState: () => ({ arEnabled: arView.enabled, arLive: arView.live, cameraOn: Boolean(stream),
      trying: tryOn.enabled, wearing: tryOn.mask.visible, faceReady: Boolean(faceTracker),
      virtualHandVisible: handModel.visible, tool: activeTool, cutting: Boolean(clayVolume.cutting), cutPoints: cutStroke?.points.length ?? 0,
      cutPreview: cutPreview.visible, pulling: Boolean(clayVolume.pulling), pending: Boolean(clayVolume.meshQueue?.pending),
      symmetry: symmetryEnabled, brushSize: activeSize, brushRadius: brushRadius(), hoverRadius: brushCue.visible ? brushCue.scale.x / clay.scale.x : 0,
      held: pinchGesture.held, grabbed: Boolean(previousPullPoint), undo: clayVolume.undoStack?.length ?? 0,
      redo: clayVolume.redoStack?.length ?? 0, anchor: previousPullPoint?.toArray(), ...diagnostics }) };
}
