import * as THREE from 'three';
import { ClayObjects } from './clayObjects.js';
import { setupClayMenu } from './clayMenu.js';
import { ReachCalibration } from './reachCalibration.js';
import { setupFullscreen } from './fullscreen.js';
import './style.css';
import { TrackingClient } from './trackingClient.js';
import { PinchGesture } from './pinchGesture.js';
import { diagnostics } from './diagnostics.js';
import { StrokePath } from './strokePath.js';
import { KnifeTool } from './knifeTool.js';
import { SurfacePull } from './surfacePull.js';
import { checkpoint, restoreHistory } from './sculptHistory.js';

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
const toolButtons = [...document.querySelectorAll('.tool-button')];
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
const pullPath = new StrokePath(0.04);
const carvePath = new StrokePath();
const bulgePath = new StrokePath();
let poseTarget = null;
let poseDisplayed = null;
let poseReceivedAt = 0;
let gapStartedAt = null;
let resumeStroke = false;
let previousRenderAt = performance.now();
let trackingEpoch = 0;
let nextTrackingAt = 0;
let stream;
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
let previousCarvePoint = null;
let previousBulgePoint = null;
let carveReference = null;
let bulgeReference = null;
let activeTool = 'pinch';
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

scene.add(new THREE.HemisphereLight('#fff9f2', '#c4a895', 2.2));
const keyLight = new THREE.DirectionalLight('#fffaf2', 2.8);
keyLight.position.set(-3, 4, 6);
scene.add(keyLight);
const warmLight = new THREE.PointLight('#de8d67', 22, 12);
warmLight.position.set(3, -2, 4);
scene.add(warmLight);

const clayObjects = new ClayObjects(scene);
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
const reachGrid = new THREE.GridHelper(5, 10, '#ae8d73', '#d2bda7');
reachGrid.position.y = -2.32;
reachGrid.material.transparent = true;
reachGrid.material.opacity = 0.28;
reachGrid.visible = false;
scene.add(reachGrid);
const centerGuide = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.5, -1.5, 0), new THREE.Vector3(1.5, -1.5, 0), new THREE.Vector3(1.5, 1.5, 0), new THREE.Vector3(-1.5, 1.5, 0)]),
  new THREE.LineDashedMaterial({ color: '#a7866d', dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.5 }),
);
centerGuide.computeLineDistances();
centerGuide.visible = false;
scene.add(centerGuide);
const contactLabel = document.querySelector('#reach-contact');
const knifeTool = new KnifeTool(scene, (volume) => {
  const item = clayObjects.items.find((item) => item.volume === volume);
  if (item) item.edited = true;
  if (volume === clayVolume) markClayEdited();
}, (message) => { if (activeTool === 'knife') { sceneHint.textContent = message; contactLabel.textContent = message; } }, checkpoint);
const depthGuide = document.querySelector('#reach-depth');
const guideToggle = document.querySelector('#show-reach-guide');
document.querySelector('#restart-reach').addEventListener('click', () => { cancelMouseStroke(); reachCalibration.reset(); });

function resetClay() {
  if (clayVolume.pulling || clayVolume.meshQueue?.pending || clayVolume.cutting) return;
  checkpoint(clayVolume);
  clayVolume.reset();
  clayObjects.active.edited = false;
  pinchActive = false;
  pinchHasContact = false;
  mousePinching = false;
  previousPullPoint = null;
  previousCarvePoint = null;
  previousBulgePoint = null;
  carveReference = null;
  bulgeReference = null;
  pinchCue.visible = false;
  resetButton.hidden = true;
  lastPinchHint = false;
  selectTool(activeTool);
  setPrompt('Fresh clay, ready to shape.', mouseMode ? `${toolDetails[activeTool].mouseHint}. Release to stop.` : toolDetails[activeTool].body, 'success');
}

function selectClayObject(id) {
  cancelMouseStroke();
  const item = clayObjects.select(id);
  clay = item.group;
  clayVolume = item.volume;
  resetButton.hidden = !item.edited;
  resetButton.title = `Reset ${item.label}`;
  clayMenu?.refresh();
  selectTool(activeTool);
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
  if (!mouseMode && activeTool !== 'pinch') {
    if (!reachCalibration.canSculpt) return null;
    const field = surface.sample ? surface : clayVolume;
    const local = clay.worldToLocal(new THREE.Vector3(handPoint.x, handPoint.y, handPoint.z));
    const distance = field.sample(local.x, local.y, local.z);
    // Webcam depth is approximate. Acquire near the surface, then allow a
    // wider band during a stroke so small depth fluctuations do not drop it.
    const continuing = surface !== clay || (activeTool === 'pinch' && previousPullPoint);
    const tolerance = continuing ? 0.34 : 0.22;
    if (!Number.isFinite(distance) || Math.abs(distance * clay.scale.x) > tolerance) return null;
    const point = local.clone();
    // Edited fields are not exact distance fields; refine the projection so
    // the brush starts on the mesh even after repeated deformation.
    for (let step = 0; step < 6; step += 1) {
      const residual = field.sample(point.x, point.y, point.z);
      if (!Number.isFinite(residual)) return null;
      if (Math.abs(residual * clay.scale.x) < 0.004) break;
      const direction = field.gradient(point.x, point.y, point.z);
      if (direction.lengthSq() < 0.1) return null;
      point.addScaledVector(direction, -THREE.MathUtils.clamp(residual, -0.12, 0.12));
    }
    if (Math.abs(field.sample(point.x, point.y, point.z) * clay.scale.x) > 0.025) return null;
    const normal = field.gradient(point.x, point.y, point.z);
    if (normal.lengthSq() < 0.1) return null;
    return { point, worldPoint: clay.localToWorld(point.clone()), worldNormal: normal };
  }
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
    pullPath.clear();
    previousPullPoint = null;
    previousPullCursorPoint = null;
    grabCursorOrigin = null; grabAnchor = null;
    return;
  }
  if (!previousPullPoint) {
    pullPath.clear();
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
    if (!volume.surfacePull.begin(currentPoint, brushRadius(), activeStrength / 100)) return;
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

function carveAlongPath(handPoint, isCarving) {
  if (!isCarving || !handPoint) {
    carvePath.clear();
    previousCarvePoint = null;
    carveReference = null;
    return;
  }
  // Remeshing replaces geometry, so these shared CPU buffers remain a stable
  // reference for the stroke without copying the entire mesh every frame.
  if (!carveReference && !getClaySurfaceHit(handPoint)) return;
  if (!carveReference) {
    if (clayVolume.meshQueue?.pending) return;
    checkpoint(clayVolume);
    carveReference = mouseMode ? clay.clone(true) : clayVolume.snapshot();
  }
  const hit = getClaySurfaceHit(handPoint, carveReference);
  if (!hit) {
    previousCarvePoint = null;
    carvePath.clear();
    carveReference = null;
    return;
  }
  let currentPoint = hit.point;
  if (!previousCarvePoint) {
    previousCarvePoint = currentPoint;
    carvePath.clear();
    return;
  }
  currentPoint = carvePath.next(previousCarvePoint, currentPoint);
  if (!currentPoint) { previousCarvePoint = null; return; }
  const motion = currentPoint.distanceTo(previousCarvePoint);
  if (motion < 0.003) return;
  const cutDepth = activeStrength === 0 ? 0 : THREE.MathUtils.lerp(0.025, 0.225, activeStrength / 100);
  if (motion >= 0.003 && clayVolume.carveStroke(previousCarvePoint, currentPoint, brushRadius(), cutDepth, 0.035, hit.worldNormal)) {
    markClayEdited();
    if (stageCaption.textContent !== 'CARVING · TRACE THE CURVE') {
      stageCaption.textContent = 'CARVING · TRACE THE CURVE';
      sceneHint.innerHTML = '<span class="hint-icon">✦</span> Keep tracing to extend the groove';
      setPrompt('Carving a groove.', 'Keep tracing to extend the curve. Switch tools to shape the clay another way.', 'success');
    }
  }
  previousCarvePoint = currentPoint;
}

function bulgeAlongPath(handPoint, isBulging) {
  if (!isBulging || !handPoint) {
    bulgePath.clear();
    previousBulgePoint = null;
    bulgeReference = null;
    return;
  }
  if (!bulgeReference && !getClaySurfaceHit(handPoint)) return;
  if (!bulgeReference) {
    if (clayVolume.meshQueue?.pending) return;
    checkpoint(clayVolume);
    bulgeReference = mouseMode ? clay.clone(true) : clayVolume.snapshot();
  }
  const hit = getClaySurfaceHit(handPoint, bulgeReference);
  if (!hit) {
    previousBulgePoint = null;
    bulgePath.clear();
    bulgeReference = null;
    return;
  }
  let currentPoint = hit.point;
  if (!previousBulgePoint) {
    previousBulgePoint = currentPoint;
    bulgePath.clear();
    return;
  }
  currentPoint = bulgePath.next(previousBulgePoint, currentPoint);
  if (!currentPoint) { previousBulgePoint = null; return; }
  const motion = currentPoint.distanceTo(previousBulgePoint);
  if (motion < 0.003) return;
  const raisedAmount = activeStrength === 0 ? 0 : THREE.MathUtils.lerp(0.015, 0.24, activeStrength / 100);
  if (motion >= 0.003 && clayVolume.applyBulge(previousBulgePoint, currentPoint, brushRadius(), raisedAmount, hit.worldNormal)) {
    markClayEdited();
    if (stageCaption.textContent !== 'BULGING · TRACE TO BUILD UP') {
      stageCaption.textContent = 'BULGING · TRACE TO BUILD UP';
      sceneHint.innerHTML = '<span class="hint-icon">✦</span> Keep tracing to raise the clay';
      setPrompt('Building up the clay.', 'Keep tracing to extend the soft raised form.', 'success');
    }
  }
  previousBulgePoint = currentPoint;
}
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64),
  new THREE.MeshBasicMaterial({ color: '#d9c7b7', transparent: true, opacity: 0.34 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -2.35, -0.7);
floor.scale.set(1.6, 0.3, 1);
scene.add(floor);

function resizeScene() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.position.z = width < 540 ? 10 : 8.6;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  cancelMouseStroke();
  clayObjects.layout(camera);
}
new ResizeObserver(resizeScene).observe(sceneHost);

function renderScene() {
  const now = performance.now();
  diagnostics.poseAgeMs = poseTarget ? now - poseReceivedAt : 0;
  const dt = Math.min(0.05, (now - previousRenderAt) / 1000);
  diagnostics.frameMs = now - previousRenderAt;
  previousRenderAt = now;
  if (!mouseMode && poseTarget && gapStartedAt === null && (activeTool === 'pinch' || reachCalibration.canSculpt) && now - poseReceivedAt < 200) {
    poseDisplayed ??= poseTarget.map((p) => p.clone());
    // One short render interpolation shared by the visible hand and tools.
    const blend = 1 - Math.exp(-dt / 0.012);
    poseDisplayed.forEach((p, i) => p.lerp(poseTarget[i], blend));
    processHandPose(poseDisplayed, pinchGesture.held);
  } else if (!mouseMode && poseTarget && now - poseReceivedAt >= 200) {
    pauseTracking(now);
  }
  depthGuide.hidden = mouseMode || activeTool === 'pinch';
  const guides = !mouseMode && activeTool !== 'pinch' && reachCalibration.ready && guideToggle.checked;
  reachGrid.visible = guides;
  centerGuide.visible = guides;
  if (guides) { centerGuide.position.copy(clay.position); centerGuide.scale.copy(clay.scale); }
  renderer.render(scene, camera);
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

const toolDetails = {
  knife: {
    context: 'Full cut', caption: 'KNIFE · OPEN PALM TO CUT', hint: 'Open your palm and sweep the blade completely through the clay',
    mouseHint: 'Drag the blade across the clay until it exits', mouseCaption: 'KNIFE · DRAG THROUGH THE CLAY',
    title: 'Slice with an open palm.', body: 'Keep your palm flat and sweep through the clay. The smaller side is removed when the blade exits. Close and reopen your hand before the next cut.',
    tipHeading: 'Open palm knife', tipCopy: 'Select Knife, straighten your fingers, then sweep across the clay in one plane.',
  },
  pinch: {
    context: 'Patch softness',
    caption: 'PINCH TOOL · PINCH TO SHAPE',
    hint: '<span class="hint-icon">✦</span> Point at the mask · pinch · drag · release',
    mouseHint: 'Click a highlighted patch and drag; release to keep it',
    mouseCaption: 'PINCH TOOL · CLICK AND DRAG TO PULL',
    title: 'Point, pinch, and drag.',
    body: 'Aim at the mask until the green ring appears. Pinch and drag to shape it; release to keep it. No reach calibration needed for this tool.',
    tipHeading: 'Pinch to shape',
    tipCopy: 'Green ring means ready. Pinch to grab, drag to reshape, and release. Undo is always nearby.',
  },
  carve: {
    context: 'Cut depth',
    caption: 'CARVE TOOL · TRACE TO CARVE',
    hint: '<span class="hint-icon">✦</span> Trace the clay with your index finger',
    mouseHint: 'Click and drag across the clay to carve',
    mouseCaption: 'CARVE TOOL · CLICK AND DRAG TO CARVE',
    title: 'Carve a curve.',
    body: 'Trace a curve across the clay with your index finger to carve a groove.',
    tipHeading: 'Carve a curve',
    tipCopy: 'Trace the clay with your index finger. Drag with the mouse in preview mode.',
  },
  bulge: {
    context: 'Raised amount',
    caption: 'BULGE TOOL · TRACE TO BUILD UP',
    hint: '<span class="hint-icon">✦</span> Trace the clay to build up a soft form',
    mouseHint: 'Click and drag to raise the clay',
    mouseCaption: 'BULGE TOOL · CLICK AND DRAG TO BUILD UP',
    title: 'Build up the clay.',
    body: 'Trace over the clay with your index finger to raise a soft, rounded form.',
    tipHeading: 'Build up the clay',
    tipCopy: 'Trace over the surface to raise the clay. Drag with the mouse in preview mode.',
  },
};

function updateStrengthControl() {
  const details = toolDetails[activeTool];
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
  const waiting = Boolean(clayVolume.pulling || clayVolume.cutting || clayVolume.meshQueue?.pending);
  undoButton.disabled = waiting || !clayVolume.undoStack?.length;
  redoButton.disabled = waiting || !clayVolume.redoStack?.length;
  resetButton.disabled = waiting;
}

function useHistory(redo = false) {
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

function selectTool(tool) {
  clayVolume.surfacePull?.finish();
  brushCue.visible = false; grabTether.visible = false;
  grabCursorOrigin = null; grabAnchor = null;
  knifeTool.reset();
  pinchGesture.reset();
  pullPath.clear(); carvePath.clear(); bulgePath.clear();
  activeTool = tool;
  strengthInput.disabled = tool === 'knife';
  sizeInput.disabled = tool === 'knife';
  document.querySelector('#size-context').textContent = tool === 'knife' ? 'Fixed full-length blade' : 'Brush width · % of starting shape';
  const details = toolDetails[tool];
  toolButtons.forEach((button) => {
    const isActive = button.dataset.tool === tool;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  updateStrengthControl();
  pinchActive = false;
  pinchHasContact = false;
  previousPullPoint = null;
  previousCarvePoint = null;
  previousBulgePoint = null;
  carveReference = null;
  bulgeReference = null;
  pinchCue.visible = false;
  stageCaption.textContent = mouseMode ? details.mouseCaption : details.caption;
  sceneHint.innerHTML = mouseMode ? `<span class="hint-icon">✦</span> ${details.mouseHint}` : details.hint;
  setPrompt(mouseMode ? 'Mouse sculpting is ready.' : details.title, mouseMode ? `${details.mouseHint}. Release to stop. Adjust ${details.context.toLowerCase()} above.` : details.body, 'success');
  tipHeading.textContent = details.tipHeading;
  tipCopy.textContent = details.tipCopy;
}

toolButtons.forEach((button) => {
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', () => selectTool(button.dataset.tool));
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
  const videoRatio = video.videoWidth / video.videoHeight;
  const frameRatio = width / height;
  const coverScaleX = Math.max(1, videoRatio / frameRatio);
  const coverOffsetX = (coverScaleX - 1) / 2;
  const points = landmarks.map(({ x, y }) => ({ x: ((1 - x) * coverScaleX - coverOffsetX) * width, y: y * height }));
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
    const alpha = 1 - Math.exp(-(activeTool === 'pinch' ? 40 : 14) * elapsed);
    landmarks.forEach((point, index) => {
      smoothedPoints[index].x += (point.x - smoothedPoints[index].x) * alpha;
      smoothedPoints[index].y += (point.y - smoothedPoints[index].y) * alpha;
      smoothedPoints[index].z += (point.z - smoothedPoints[index].z) * alpha;
    });
  }
  window.lastSmoothTime = now;
  const scaleX = 4.8;
  const scaleY = Math.min(4.8 * (sceneHost.clientHeight / sceneHost.clientWidth), 3.5);
  // Image-space landmarks already carry camera perspective: nearer hands occupy more pixels.
  // MediaPipe landmark Z is relative to the wrist, not a global camera-distance value.
  const pointAt = (point) => ({
    x: (0.5 - point.x) * scaleX,
    y: (0.5 - point.y) * scaleY,
    // MediaPipe depth gets smaller as the hand moves toward the camera; Three.js uses +Z toward the camera.
    z: -point.z * 2.3,
  });
  let mappedPoints = smoothedPoints.map(pointAt);
  if (!mouseMode && activeTool === 'pinch') {
    // Screen-space aim is usable immediately, independently of approximate
    // webcam depth. Freeze edits during missing frames but keep a brief grab.
    if (gapStartedAt !== null) {
      const midpointShift = poseTarget ? new THREE.Vector3(mappedPoints[8].x, mappedPoints[8].y, mappedPoints[8].z).distanceTo(poseTarget[8]) : 0;
      if (now - gapStartedAt > 700 || midpointShift > 1.2) cancelMouseStroke();
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
  if (!mouseMode) {
    reachCalibration.observe(landmarks, worldLandmarks, handedness, video.videoWidth / video.videoHeight, now);
    mappedPoints = reachCalibration.map(worldLandmarks, now);
    if (!mappedPoints) {
      handModel.visible = reachCalibration.ready && now - (reachCalibration.lastMappedAt ?? 0) < 180;
      if (reachCalibration.ready && !reachCalibration.capturing) pauseTracking(now);
      else cancelMouseStroke();
      contactCue.visible = false;
      if (reachCalibration.ready || reachCalibration.capturing || !reachCalibration.valid) {
        stageCaption.textContent = reachCalibration.capturing ? 'CAPTURING YOUR REACH' : 'WAITING FOR A STABLE HAND POSE';
        sceneHint.textContent = reachCalibration.capturing ? 'Follow the countdown in Calibrate reach' : 'Keep your calibrated hand and wrist fully visible';
        contactLabel.textContent = reachCalibration.capturing ? 'Calibration in progress' : 'Sculpting paused';
        setPrompt('Let’s position your hand.', reachCalibration.status.textContent, 'neutral');
        return;
      }
      stageCaption.textContent = 'CALIBRATE YOUR REACH TO SCULPT';
      setStatus('neutral', 'HAND DETECTED · CALIBRATE REACH');
      sceneHint.textContent = 'Set your near position, then your forward reach';
      setPrompt('Let’s place the clay within reach.', 'Open Calibrate reach in the play area. Capture a near-body pose, then a comfortable forward reach. Keep the same open palm.', 'neutral');
      return;
    }
  }
  if (!mouseMode) {
    if (gapStartedAt !== null) {
      const rootShift = poseTarget ? mappedPoints[0].distanceTo(poseTarget[0]) : Infinity;
      if (now - gapStartedAt > 180 || rootShift > 0.35) cancelMouseStroke();
      resumeStroke = true;
      gapStartedAt = null;
      poseDisplayed = mappedPoints.map((p) => p.clone());
    }
    pinchGesture.update(landmarks, now, video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1);
    poseTarget = mappedPoints;
    poseReceivedAt = now;
    // Show calibration poses, but perform edits only from the render loop.
    if (!reachCalibration.canSculpt) {
      updateHandSurface(mappedPoints);
      if (reachCalibration.depthUncertain) pauseTracking(now);
      else cancelMouseStroke();
    }
    return;
  }
  processHandPose(mappedPoints, pinchOverride);
}

function processHandPose(mappedPoints, pinchOverride = null) {
  // In mouse preview, align the sculpting fingertip/grab with the actual cursor.
  if (mouseMode && mouseSculptPoint) {
    const anchor = mappedPoints[8];
    const offset = new THREE.Vector3().subVectors(mouseSculptPoint, anchor);
    mappedPoints.forEach((point) => { point.x += offset.x; point.y += offset.y; });
  }
  handModel.position.z = mouseMode ? 1.3 : 0;
  updateHandSurface(mappedPoints);
  scenePlaceholder.classList.add('is-hidden');
  if (clayVolume.meshFailed) {
    cancelMouseStroke();
    setPrompt('Clay updates paused.', 'The background sculpting worker stopped. Reload the page to restart the studio.', 'warning');
    return;
  }
  if (clayMenu?.isOpen || (!mouseMode && activeTool !== 'pinch' && !reachCalibration.canSculpt)) {
    cancelMouseStroke();
    contactCue.visible = false;
    contactLabel.textContent = 'Close the menu to sculpt';
    return;
  }
  if (volumeBusy()) return;
  if (activeTool === 'knife') {
    contactCue.visible = false;
    pinchCue.visible = false;
    knifeTool.update(mappedPoints, clay, clayVolume, mouseMode ? mousePinching : null);
    return;
  }
  if (activeSize === 0) {
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
  let surfaceHit = previousPullPoint && activeTool === 'pinch' ? null : getClaySurfaceHit(sculptPoint);
  if (activeTool === 'pinch' && !previousPullPoint) {
    const now = performance.now();
    if (surfaceHit && !pinchActive) { recentGrabHit = surfaceHit; recentGrabAt = now; }
    // Closing the fingers can shift the tracked fingertip off an edge. Keep
    // the patch the user just pointed at, rather than making them aim again.
    if (!surfaceHit && pinchActive && !wasPinching && recentGrabHit && now - recentGrabAt < 220
      && Math.hypot(recentGrabHit.worldPoint.x - sculptPoint.x, recentGrabHit.worldPoint.y - sculptPoint.y) < 0.2) surfaceHit = recentGrabHit;
  }
  const contact = activeTool === 'pinch' ? surfaceHit : getClaySurfaceHit(index);
  contactCue.visible = !mouseMode && Boolean(contact) && activeSize > 0;
  contactCue.scale.setScalar(activeTool === 'pinch' ? Math.min(1, brushRadius() * clay.scale.x / 0.065 * 0.3) : 1);
  if (contactCue.visible) contactCue.position.copy(contact.worldPoint);
  contactLabel.textContent = previousPullPoint && pinchActive ? 'Patch grabbed · drag to reshape' : contact ? 'Ready to grab' : 'Point at the mask';
  brushCue.visible = activeTool === 'pinch' && Boolean(contact) && !previousPullPoint && activeSize > 0;
  if (brushCue.visible) {
    brushCue.position.copy(contact.worldPoint); brushCue.position.z += 0.035;
    brushCue.scale.setScalar(brushRadius() * clay.scale.x);
    brushCue.material.color.set(clayVolume.meshQueue?.pending ? '#be914b' : '#538c68');
  }
  diagnostics.pinch = pinchActive ? 'held' : 'open';
  diagnostics.pause = 'none';
  contactLabel.dataset.contact = String(Boolean(contact));
  if (resumeStroke) {
    pullPath.clear(); carvePath.clear(); bulgePath.clear();
    if (previousPullPoint) previousPullCursorPoint = clay.worldToLocal(sculptPoint.clone());
    previousCarvePoint = null; previousBulgePoint = null;
    resumeStroke = false;
  }
  const sculptStartedAt = performance.now();
  pullClayAlongPath(sculptPoint, activeTool === 'pinch' && pinchActive, surfaceHit?.point ?? null);
  if (previousPullPoint) {
    pinchCue.position.copy(clay.localToWorld(previousPullPoint.clone()));
    pinchCue.position.z += 0.09;
  }
  const hasPinchContact = activeTool === 'pinch' && pinchActive && Boolean(previousPullPoint);
  if (hasPinchContact) {
    pinchCue.material.color.set('#7cb58b'); grabTether.material.color.set('#538c68');
  }
  pinchCue.visible = hasPinchContact;
  pinchCue.scale.setScalar(pinchActive ? 1.12 : 0.8);
  carveAlongPath(index, activeTool === 'carve' && (!mouseMode || mousePinching));
  bulgeAlongPath(index, activeTool === 'bulge' && (!mouseMode || mousePinching));
  diagnostics.sculptMs = performance.now() - sculptStartedAt;
  if (activeTool === 'pinch' && (pinchActive !== wasPinching || hasPinchContact !== pinchHasContact)) {
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
        setPrompt(toolDetails.pinch.title, toolDetails.pinch.body, 'success');
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
  tipCopy.textContent = toolDetails[activeTool].tipCopy;
  if (!lastPinchHint && !pinchActive) {
    const details = toolDetails[activeTool];
    setPrompt(details.title, details.body, 'success');
    stageCaption.textContent = `HAND TRACKED · ${details.caption.replace(/^[^·]+·\s*/, '')}`;
    sceneHint.innerHTML = details.hint;
  }
  document.querySelector('#check-hand').classList.add('is-done');
  updateThreeSkeleton(landmarks, now, null, worldLandmarks, handedness);
  drawPreviewSkeleton(smoothedPoints ?? landmarks);
}

function pauseTracking(now) {
  knifeTool.reset();
  if (gapStartedAt === null) { gapStartedAt = now; diagnostics.dropouts++; pinchGesture.uncertain(); }
  diagnostics.pause = 'tracking uncertain';
  contactCue.visible = false;
  brushCue.visible = false;
  pinchCue.material.color.set('#d6a355'); grabTether.material.color.set('#d6a355');
  if (previousPullPoint) {
    contactLabel.textContent = 'Grab paused · bring your hand back';
    sceneHint.textContent = 'Hand briefly lost · your patch is held, edits are paused';
  }
  if (now - gapStartedAt > (activeTool === 'pinch' ? 700 : 180)) {
    cancelMouseStroke();
    handModel.visible = false;
  }
}

function showNoHand(now) {
  pauseTracking(now);
  if (now - gapStartedAt <= (activeTool === 'pinch' ? 700 : 180) && (activeTool === 'pinch' || reachCalibration.ready)) {
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
  previousCarvePoint = null;
  previousBulgePoint = null;
  carveReference = null;
  bulgeReference = null;
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

async function startCamera() {
  mouseMode = false;
  cameraButton.disabled = true;
  buttonLabel.textContent = 'Opening camera…';
  setStatus('loading', 'SETTING UP');
  landmarkCount.textContent = '21 LANDMARKS · LOADING';
  setPrompt('Waking up the studio…', 'Opening your camera, then loading hand tracking. This can take a few seconds.', 'neutral');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    });
    video.srcObject = stream;
    await video.play();
    videoWidth = video.videoWidth;
    videoHeight = video.videoHeight;
    videoPlaceholder.hidden = true;
    videoLive.classList.add('is-visible');
    cameraStatus.textContent = 'ON';
    cameraStatus.classList.add('is-on');
    document.querySelector('#check-camera').classList.add('is-done');
  } catch (error) {
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
  }
  await startTracking();
}

function stopCamera(resetLandmarker = true) {
  trackingEpoch++;
  poseTarget = null; poseDisplayed = null; gapStartedAt = null;
  pinchGesture.reset();
  reachCalibration.reset();
  contactCue.visible = false;
  pinchActive = false;
  pinchHasContact = false;
  mousePinching = false;
  pinchCue.visible = false;
  previousBulgePoint = null;
  carveReference = null;
  bulgeReference = null;
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
    previousCarvePoint = null;
    smoothedPoints = null;
    window.lastSmoothTime = 0;
    landmarkCount.textContent = '21 LANDMARKS · WAITING';
  }
}

cameraButton.addEventListener('click', () => {
  if (stream) {
    if (!landmarker) {
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
    previousCarvePoint = null;
    previousBulgePoint = null;
    pinchActive = false;
    mousePinching = false;
    pinchCue.visible = false;
    carveReference = null;
    bulgeReference = null;
    document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
    mouseButton.textContent = 'Preview with mouse';
    return;
  }
  stopCamera();
  mouseMode = true;
  setStatus('ready', 'MOUSE SCULPTING');
  landmarkCount.textContent = '21 LANDMARKS · MOUSE';
  scenePlaceholder.classList.add('is-hidden');
  const details = toolDetails[activeTool];
  stageCaption.textContent = details.mouseCaption;
  sceneHint.innerHTML = `<span class="hint-icon">✦</span> ${details.mouseHint}`;
  setPrompt('Mouse sculpting is ready.', `${details.mouseHint}. Release to stop. Adjust ${details.context.toLowerCase()} above.`, 'success');
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
  recentGrabHit = null;
  clayVolume.surfacePull?.finish();
  brushCue.visible = false; grabTether.visible = false;
  grabCursorOrigin = null; grabAnchor = null;
  knifeTool.reset();
  pullPath.clear(); carvePath.clear(); bulgePath.clear();
  pinchGesture.reset();
  resumeStroke = false;
  contactCue.visible = false;
  contactLabel.dataset.contact = 'false';
  contactLabel.textContent = reachCalibration.ready ? 'Move your fingertips to the surface' : 'Calibrate before sculpting';
  mousePinching = false;
  pinchActive = false;
  pinchHasContact = false;
  pinchCue.visible = false;
  previousPullPoint = null;
  previousPullCursorPoint = null;
  previousCarvePoint = null;
  previousBulgePoint = null;
  carveReference = null;
  bulgeReference = null;
}
function volumeBusy() {
  if (clayVolume.pulling && (!previousPullPoint || activeTool !== 'pinch')) {
    contactLabel.textContent = 'Keeping your change…'; return true;
  }
  if (!clayVolume.cutting) return false;
  contactLabel.textContent = 'Finishing cut…';
  return true;
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
  window.clayPlayDebug = { objects: clayObjects, camera,
    feedHand: updateThreeSkeleton, pauseHand: pauseTracking, cancel: cancelMouseStroke,
    getState: () => ({ pulling: Boolean(clayVolume.pulling), pending: Boolean(clayVolume.meshQueue?.pending),
      brushSize: activeSize, brushRadius: brushRadius(), hoverRadius: brushCue.visible ? brushCue.scale.x / clay.scale.x : 0,
      held: pinchGesture.held, grabbed: Boolean(previousPullPoint), undo: clayVolume.undoStack?.length ?? 0,
      redo: clayVolume.redoStack?.length ?? 0, anchor: previousPullPoint?.toArray(), ...diagnostics }) };
}
