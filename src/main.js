import * as THREE from 'three';
import { ClayObjects } from './clayObjects.js';
import { setupClayMenu } from './clayMenu.js';
import { setupFullscreen } from './fullscreen.js';
import './style.css';

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
const toolButtons = [...document.querySelectorAll('.tool-button')];
const strengthInput = document.querySelector('#tool-strength');
const strengthValue = document.querySelector('#strength-value');
const strengthContext = document.querySelector('#strength-context');

const connectionLines = [
  [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[17,0], [0,5],[0,17],
];

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

function resetClay() {
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
const handSkin = new THREE.MeshStandardMaterial({ color: '#d9a17f', roughness: 0.72 });
const palmSkin = new THREE.MeshStandardMaterial({ color: '#e1b08f', roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
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
    previousPullPoint = null;
    previousPullCursorPoint = null;
    return;
  }
  if (!previousPullPoint) {
    const currentPoint = surfacePoint === undefined ? getClaySurfacePoint(handPoint) : surfacePoint;
    if (!currentPoint) return;
    previousPullPoint = currentPoint;
    previousPullCursorPoint = currentPoint.clone();
    pullPlane.constant = -clay.localToWorld(currentPoint.clone()).z;
    return;
  }
  // Hold the original grab plane after contact, including beyond the silhouette.
  clayRaycaster.set(camera.position, new THREE.Vector3(handPoint.x, handPoint.y, 0).sub(camera.position).normalize());
  const cursor = clayRaycaster.ray.intersectPlane(pullPlane, new THREE.Vector3());
  if (!cursor) return;
  clay.worldToLocal(cursor);
  if (activeStrength === 0) {
    previousPullCursorPoint = cursor;
    return;
  }
  const target = previousPullPoint.clone().add(cursor.clone().sub(previousPullCursorPoint));
  const appliedPoint = clayVolume.applyPull(previousPullPoint, target, 0.3, activeStrength / 100);
  if (appliedPoint) {
    markClayEdited();
    previousPullPoint = appliedPoint;
    previousPullCursorPoint = cursor;
  }
}

function carveAlongPath(handPoint, isCarving) {
  if (!isCarving || !handPoint) {
    previousCarvePoint = null;
    carveReference = null;
    return;
  }
  // Remeshing replaces geometry, so these shared CPU buffers remain a stable
  // reference for the stroke without copying the entire mesh every frame.
  carveReference ??= clay.clone(true);
  const hit = getClaySurfaceHit(handPoint, carveReference);
  if (!hit) {
    previousCarvePoint = null;
    carveReference = null;
    return;
  }
  const currentPoint = hit.point;
  if (!previousCarvePoint) {
    previousCarvePoint = currentPoint;
    return;
  }
  const motion = currentPoint.distanceTo(previousCarvePoint);
  const cutDepth = activeStrength === 0 ? 0 : THREE.MathUtils.lerp(0.025, 0.225, activeStrength / 100);
  if (motion >= 0.003 && clayVolume.carveStroke(previousCarvePoint, currentPoint, 0.105, cutDepth, 0.035, hit.worldNormal)) {
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
    previousBulgePoint = null;
    bulgeReference = null;
    return;
  }
  bulgeReference ??= clay.clone(true);
  const hit = getClaySurfaceHit(handPoint, bulgeReference);
  if (!hit) {
    previousBulgePoint = null;
    bulgeReference = null;
    return;
  }
  const currentPoint = hit.point;
  if (!previousBulgePoint) {
    previousBulgePoint = currentPoint;
    return;
  }
  const motion = currentPoint.distanceTo(previousBulgePoint);
  const raisedAmount = activeStrength === 0 ? 0 : THREE.MathUtils.lerp(0.015, 0.24, activeStrength / 100);
  if (motion >= 0.003 && clayVolume.applyBulge(previousBulgePoint, currentPoint, 0.28, raisedAmount, hit.worldNormal)) {
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
  renderer.render(scene, camera);
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
  pinch: {
    context: 'Pull distance',
    caption: 'PINCH TOOL · PINCH TO SHAPE',
    hint: '<span class="hint-icon">✦</span> Pinch over the clay, then pull',
    mouseHint: 'Click and drag to pull the clay',
    mouseCaption: 'PINCH TOOL · CLICK AND DRAG TO PULL',
    title: 'Pinch the clay, then pull.',
    body: 'Bring thumb and index finger together over the clay, then move your hand gently.',
    tipHeading: 'Pinch to shape',
    tipCopy: 'Bring thumb and index finger together over the clay, then pull gently.',
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

function selectTool(tool) {
  activeTool = tool;
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

function updateThreeSkeleton(landmarks, now, pinchOverride = null) {
  if (!smoothedPoints || smoothedPoints.length !== landmarks.length) {
    smoothedPoints = landmarks.map(({ x, y, z }) => ({ x, y, z }));
  } else {
    const elapsed = Math.min((now - (window.lastSmoothTime || now - 16)) / 1000, 0.1);
    const alpha = 1 - Math.exp(-14 * elapsed);
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
  const mappedPoints = smoothedPoints.map(pointAt);
  // In mouse preview, align the sculpting fingertip/grab with the actual cursor.
  if (mouseMode && mouseSculptPoint) {
    const anchor = activeTool === 'pinch'
      ? new THREE.Vector3().addVectors(mappedPoints[4], mappedPoints[8]).multiplyScalar(0.5)
      : mappedPoints[8];
    const offset = new THREE.Vector3().subVectors(mouseSculptPoint, anchor);
    mappedPoints.forEach((point) => { point.x += offset.x; point.y += offset.y; });
  }
  updateHandSurface(mappedPoints);
  scenePlaceholder.classList.add('is-hidden');
  if (clayMenu?.isOpen) return;
  const pinchDistance = Math.hypot(smoothedPoints[4].x - smoothedPoints[8].x, smoothedPoints[4].y - smoothedPoints[8].y);
  const palmWidth = Math.max(0.04, Math.hypot(smoothedPoints[5].x - smoothedPoints[17].x, smoothedPoints[5].y - smoothedPoints[17].y));
  const pinchRatio = pinchDistance / palmWidth;
  const wasPinching = pinchActive;
  if (pinchOverride !== null) pinchActive = pinchOverride;
  else if (!pinchActive && pinchRatio < 0.34) pinchActive = true;
  else if (pinchActive && pinchRatio > 0.48) pinchActive = false;

  const thumb = mappedPoints[4];
  const index = mappedPoints[8];
  const sculptPoint = new THREE.Vector3((thumb.x + index.x) / 2, (thumb.y + index.y) / 2, 0);
  const surfaceHit = getClaySurfaceHit(sculptPoint);
  pullClayAlongPath(sculptPoint, activeTool === 'pinch' && pinchActive, surfaceHit?.point ?? null);
  if (previousPullPoint) {
    pinchCue.position.copy(clay.localToWorld(previousPullPoint.clone()));
    pinchCue.position.z += 0.09;
  }
  const hasPinchContact = activeTool === 'pinch' && pinchActive && Boolean(previousPullPoint);
  pinchCue.visible = hasPinchContact;
  pinchCue.scale.setScalar(pinchActive ? 1.12 : 0.8);
  carveAlongPath(index, activeTool === 'carve' && (!mouseMode || mousePinching));
  bulgeAlongPath(index, activeTool === 'bulge' && (!mouseMode || mousePinching));
  if (activeTool === 'pinch' && (pinchActive !== wasPinching || hasPinchContact !== pinchHasContact)) {
    lastPinchHint = true;
    if (pinchActive) {
      if (hasPinchContact) {
        stageCaption.textContent = 'PINCH ACTIVE · PULL TO SHAPE';
        sceneHint.innerHTML = '<span class="hint-icon">✦</span> Pull gently to stretch the clay';
        setPrompt('Pinch the clay, then pull.', 'Release your fingers to stop. Pull slowly for a softer shape.', 'success');
      } else {
        stageCaption.textContent = 'PINCH ACTIVE · FIND THE CLAY';
        sceneHint.innerHTML = '<span class="hint-icon">↗</span> Move the pinched fingertips onto the clay';
        setPrompt('Move your pinch onto the clay.', 'The fingertips need to touch the clay surface before a pull can begin.', 'warning');
      }
    } else {
      if (pinchHasContact) {
        stageCaption.textContent = 'CLAY SHAPED · READY FOR MORE';
        sceneHint.innerHTML = '<span class="hint-icon">✦</span> Lovely shape — pinch again to keep going';
        setPrompt('Nice pull.', 'Pinch again to shape another spot, or reset the clay to start fresh.', 'success');
      } else {
        stageCaption.textContent = 'HAND TRACKED · PINCH TO SHAPE';
        sceneHint.innerHTML = '<span class="hint-icon">✦</span> Pinch over the clay, then pull';
        setPrompt(toolDetails.pinch.title, toolDetails.pinch.body, 'success');
      }
    }
  }
  pinchHasContact = hasPinchContact;
}

function showTracking(landmarks, now) {
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
  drawPreviewSkeleton(landmarks);
  updateThreeSkeleton(landmarks, now);
}

function showNoHand(now) {
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

function trackingLoop() {
  if (!stream || !landmarker) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());
    if (result.landmarks?.length) showTracking(result.landmarks[0], performance.now());
    else showNoHand(performance.now());
  }
  retryTimer = requestAnimationFrame(trackingLoop);
}

async function createLandmarker() {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
  const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.52, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.48,
    });
  } catch (gpuError) {
    console.warn('ClayPlay GPU hand tracking setup failed; trying CPU:', gpuError);
    try {
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.52, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.48,
      });
    } catch (cpuError) {
      console.error('ClayPlay CPU hand tracking setup failed:', cpuError);
      throw cpuError;
    }
  }
}

async function startTracking() {
  cameraButton.disabled = true;
  buttonLabel.textContent = 'Loading tracking…';
  setStatus('loading', 'SETTING UP');
  landmarkCount.textContent = '21 LANDMARKS · LOADING';
  try {
    landmarker = await createLandmarker();
    buttonLabel.textContent = 'Camera on';
    cameraButton.classList.add('is-secondary');
    cameraButton.disabled = false;
    mouseButton.hidden = true;
    setPrompt('Camera’s ready. Show us one hand.', 'Hold your palm toward the camera, with your wrist in view.', 'success');
    trackingLoop();
  } catch (error) {
    console.error('ClayPlay hand tracking setup failed:', error);
    cameraButton.disabled = false;
    buttonLabel.textContent = 'Retry tracking';
    mouseButton.hidden = false;
    setStatus('error', 'TRACKING UNAVAILABLE');
    landmarkCount.textContent = '21 LANDMARKS · OFFLINE';
    setPrompt('Your camera is on, but tracking didn’t load.', 'Check your internet connection and retry. The hand-tracking files are loaded from the web.', 'warning');
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
sceneHost.addEventListener('pointercancel', cancelMouseStroke);
sceneHost.addEventListener('lostpointercapture', cancelMouseStroke);

clayMenu = setupClayMenu(clayObjects, {
  onSelect: selectClayObject,
  onLayout: () => { cancelMouseStroke(); clayObjects.layout(camera); },
  onPause: () => cancelMouseStroke(),
});

setupFullscreen(document.querySelector('#stage'), cancelMouseStroke);

resetButton.addEventListener('pointerdown', (event) => event.stopPropagation());
resetButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resetClay();
});

window.addEventListener('beforeunload', () => {
  stopCamera();
  cancelAnimationFrame(animationFrame);
});
