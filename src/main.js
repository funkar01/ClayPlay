import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
let previousSculptPoint = null;
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

const clayGeometry = mergeVertices(new THREE.IcosahedronGeometry(1.25, 5));
const clayPositions = clayGeometry.attributes.position;
clayGeometry.computeVertexNormals();
const originalClayPositions = new Float32Array(clayPositions.array);
const clayMaterial = new THREE.MeshPhysicalMaterial({
  color: '#bd7455', roughness: 0.78, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.9,
});
const clay = new THREE.Mesh(clayGeometry, clayMaterial);
clay.position.set(0, -0.08, 0);
clay.castShadow = true;
clay.receiveShadow = true;
scene.add(clay);

const pinchCue = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 20, 16),
  new THREE.MeshBasicMaterial({ color: '#f3be87', transparent: true, opacity: 0.82 })
);
pinchCue.visible = false;
scene.add(pinchCue);

const clayRadius = 1.25;
const clayCenter = clay.position;
function resetClay() {
  clayPositions.array.set(originalClayPositions);
  clayPositions.needsUpdate = true;
  clayGeometry.computeVertexNormals();
  pinchActive = false;
  previousSculptPoint = null;
  resetButton.hidden = true;
  if (lastPinchHint) setPrompt('Fresh clay, ready to shape.', 'Pinch the clay, then pull. Release your fingers to let it settle.', 'success');
}

function deformClay(point, isPinching) {
  if (!isPinching) {
    previousSculptPoint = null;
    return;
  }
  const localPoint = clay.worldToLocal(point.clone());
  const radialSquared = localPoint.x * localPoint.x + localPoint.y * localPoint.y;
  if (radialSquared > clayRadius * clayRadius * 0.96) {
    previousSculptPoint = localPoint;
    return;
  }
  const surfaceZ = Math.sqrt(Math.max(0, clayRadius * clayRadius - radialSquared));
  localPoint.z = surfaceZ;
  if (!previousSculptPoint) {
    previousSculptPoint = localPoint;
    return;
  }
  const movement = localPoint.clone().sub(previousSculptPoint);
  const planarMotion = Math.hypot(movement.x, movement.y);
  if (planarMotion < 0.003) {
    previousSculptPoint = localPoint;
    return;
  }
  movement.x = THREE.MathUtils.clamp(movement.x, -0.15, 0.15);
  movement.y = THREE.MathUtils.clamp(movement.y, -0.15, 0.15);
  movement.z = Math.min(0.16, planarMotion * 0.48);
  const brushRadius = 0.62;
  const cursorX = localPoint.x;
  const cursorY = localPoint.y;
  for (let index = 0; index < clayPositions.count; index += 1) {
    const x = clayPositions.getX(index);
    const y = clayPositions.getY(index);
    const z = clayPositions.getZ(index);
    if (z < -0.05) continue;
    const distance = Math.hypot(x - cursorX, y - cursorY);
    if (distance >= brushRadius) continue;
    const t = distance / brushRadius;
    const falloff = (1 - t * t) ** 2;
    clayPositions.setXYZ(index, x + movement.x * falloff, y + movement.y * falloff, z + movement.z * falloff);
  }
  clayPositions.needsUpdate = true;
  clayGeometry.computeVertexNormals();
  previousSculptPoint = localPoint;
  resetButton.hidden = false;
}

const pointsGeometry = new THREE.BufferGeometry();
const pointsPositions = new Float32Array(21 * 3);
pointsGeometry.setAttribute('position', new THREE.BufferAttribute(pointsPositions, 3));
const pointsMaterial = new THREE.PointsMaterial({ color: '#ba6649', size: 0.11, sizeAttenuation: true, transparent: true, opacity: 0.92 });
const pointsMesh = new THREE.Points(pointsGeometry, pointsMaterial);
pointsMesh.visible = false;
scene.add(pointsMesh);

const linePositions = new Float32Array(connectionLines.length * 2 * 3);
const linesGeometry = new THREE.BufferGeometry();
linesGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
const linesMaterial = new THREE.LineBasicMaterial({ color: '#9f5038', transparent: true, opacity: 0.48 });
const linesMesh = new THREE.LineSegments(linesGeometry, linesMaterial);
linesMesh.visible = false;
scene.add(linesMesh);

const palmGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.44, 32, 24),
  new THREE.MeshPhysicalMaterial({ color: '#d99774', roughness: 0.48, metalness: 0, clearcoat: 0.2, transparent: true, opacity: 0.12 })
);
palmGlow.scale.set(0.85, 1, 0.55);
palmGlow.visible = false;
scene.add(palmGlow);

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
  const pointAt = (point) => ({
    x: (0.5 - point.x) * scaleX,
    y: (0.5 - point.y) * scaleY,
    z: -point.z * 2.3,
  });
  smoothedPoints.forEach((point, index) => {
    const mapped = pointAt(point);
    pointsPositions[index * 3] = mapped.x;
    pointsPositions[index * 3 + 1] = mapped.y;
    pointsPositions[index * 3 + 2] = mapped.z;
  });
  pointsGeometry.attributes.position.needsUpdate = true;
  connectionLines.forEach(([start, end], index) => {
    linePositions.set(pointsPositions.subarray(start * 3, start * 3 + 3), index * 6);
    linePositions.set(pointsPositions.subarray(end * 3, end * 3 + 3), index * 6 + 3);
  });
  linesGeometry.attributes.position.needsUpdate = true;
  const palm = pointAt(smoothedPoints[0]);
  palmGlow.position.set(palm.x, palm.y, palm.z - 0.4);
  palmGlow.visible = true;
  pointsMesh.visible = true;
  linesMesh.visible = true;
  scenePlaceholder.classList.add('is-hidden');
  const pinchDistance = Math.hypot(smoothedPoints[4].x - smoothedPoints[8].x, smoothedPoints[4].y - smoothedPoints[8].y);
  const palmWidth = Math.max(0.04, Math.hypot(smoothedPoints[5].x - smoothedPoints[17].x, smoothedPoints[5].y - smoothedPoints[17].y));
  const pinchRatio = pinchDistance / palmWidth;
  const wasPinching = pinchActive;
  if (pinchOverride !== null) pinchActive = pinchOverride;
  else if (!pinchActive && pinchRatio < 0.34) pinchActive = true;
  else if (pinchActive && pinchRatio > 0.48) pinchActive = false;

  const thumb = pointAt(smoothedPoints[4]);
  const index = pointAt(smoothedPoints[8]);
  const sculptPoint = new THREE.Vector3((thumb.x + index.x) / 2, (thumb.y + index.y) / 2, 0);
  const insideClay = Math.hypot(sculptPoint.x - clayCenter.x, sculptPoint.y - clayCenter.y) < clayRadius * 1.08;
  pinchCue.position.set(sculptPoint.x, sculptPoint.y, 1.42);
  pinchCue.visible = pinchActive;
  pinchCue.scale.setScalar(pinchActive ? 1.12 : 0.8);
  if (pinchActive && insideClay) deformClay(sculptPoint, true);
  else deformClay(sculptPoint, false);
  if (pinchActive !== wasPinching) {
    lastPinchHint = true;
    if (pinchActive) {
      stageCaption.textContent = 'PINCH ACTIVE · PULL TO SHAPE';
      sceneHint.innerHTML = '<span class="hint-icon">✦</span> Pull gently to stretch the clay';
      setPrompt('Pinch the clay, then pull.', 'Release your fingers to stop. Pull slowly for a softer shape.', 'success');
    } else {
      stageCaption.textContent = 'CLAY SHAPED · READY FOR MORE';
      sceneHint.innerHTML = '<span class="hint-icon">✦</span> Lovely shape — pinch again to keep going';
      setPrompt('Nice pull.', 'Pinch again to shape another spot, or reset the clay to start fresh.', 'success');
    }
  }
}

function showTracking(landmarks, now) {
  lastHandAt = now;
  noHandSince = 0;
  wasTracking = true;
  setStatus('ready', 'HAND DETECTED');
  landmarkCount.textContent = '21 LANDMARKS · 1 HAND';
  if (!lastPinchHint && !pinchActive) {
    setPrompt('Pinch the clay, then pull.', 'Bring thumb and index finger together over the clay, then move your hand gently.', 'success');
    stageCaption.textContent = 'HAND TRACKED · PINCH TO SHAPE';
    sceneHint.innerHTML = '<span class="hint-icon">✦</span> Pinch over the clay, then pull';
  }
  document.querySelector('#check-hand').classList.add('is-done');
  drawPreviewSkeleton(landmarks);
  updateThreeSkeleton(landmarks, now);
}

function showNoHand(now) {
  if (!noHandSince) noHandSince = now;
  clearPreview();
  pinchActive = false;
  previousSculptPoint = null;
  pinchCue.visible = false;
  landmarkCount.textContent = '21 LANDMARKS · WAITING';
  const lost = wasTracking && now - lastHandAt > 900;
  const needsHint = now - noHandSince > 2800;
  if (lost) {
    pointsMesh.visible = false;
    linesMesh.visible = false;
    palmGlow.visible = false;
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
    pointsMesh.visible = false;
    linesMesh.visible = false;
    palmGlow.visible = false;
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
    pointsMesh.visible = false;
    linesMesh.visible = false;
    palmGlow.visible = false;
    document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
    mouseButton.textContent = 'Preview with mouse';
    return;
  }
  stopCamera();
  mouseMode = true;
  setStatus('ready', 'MOUSE SCULPTING');
  landmarkCount.textContent = '21 LANDMARKS · MOUSE';
  stageCaption.textContent = 'MOUSE PREVIEW · MOVE YOUR POINTER';
  sceneHint.innerHTML = '<span class="hint-icon">✦</span> Move your pointer to move the hand';
  setPrompt('Mouse sculpting is ready.', 'Click and drag across the clay to pinch and pull. Release to stop.', 'success');
  stageCaption.textContent = 'CLICK AND DRAG TO SHAPE';
  sceneHint.innerHTML = '<span class="hint-icon">✦</span> Click and drag the clay';
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
sceneHost.addEventListener('pointermove', (event) => {
  if (!mouseMode) return;
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
  if (!mouseMode) return;
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
  mousePinching = false;
  const bounds = sceneHost.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  const size = Math.min(bounds.width, bounds.height) / bounds.width;
  const landmarks = handShape.map(([offsetX, offsetY]) => ({ x: Math.max(0.02, Math.min(0.98, x + offsetX * size)), y: Math.max(0.02, Math.min(0.98, y + offsetY * size)), z: 0 }));
  updateThreeSkeleton(landmarks, performance.now(), false);
});

resetButton.addEventListener('click', resetClay);

window.addEventListener('beforeunload', () => {
  stopCamera();
  cancelAnimationFrame(animationFrame);
});
