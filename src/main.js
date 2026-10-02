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
let previousFingerPaths = null;
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
  mousePinching = false;
  previousFingerPaths = null;
  resetButton.hidden = true;
  if (lastPinchHint) setPrompt('Fresh clay, ready to shape.', 'Pinch the clay, then pull. Release your fingers to let it settle.', 'success');
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

function makeFingerPaths(mappedPoints) {
  return fingerChains.map((chain) => chain.map((landmarkIndex) => {
    const local = clay.worldToLocal(new THREE.Vector3(mappedPoints[landmarkIndex].x, mappedPoints[landmarkIndex].y, 0));
    const distanceSquared = local.x * local.x + local.y * local.y;
    local.z = Math.sqrt(Math.max(0, clayRadius * clayRadius - Math.min(distanceSquared, clayRadius * clayRadius)));
    return local;
  }));
}

function deformAlongFingerPaths(mappedPoints, isPinching) {
  if (!isPinching) {
    previousFingerPaths = null;
    return;
  }
  const currentPaths = makeFingerPaths(mappedPoints);
  if (!previousFingerPaths) {
    previousFingerPaths = currentPaths;
    return;
  }

  const accumulated = new Float32Array(clayPositions.count * 3);
  const weights = new Float32Array(clayPositions.count);
  for (let fingerIndex = 0; fingerIndex < currentPaths.length; fingerIndex += 1) {
    const current = currentPaths[fingerIndex];
    const previous = previousFingerPaths[fingerIndex];
    const radius = fingerIndex < 2 ? 0.17 : 0.14;
    for (let segmentIndex = 0; segmentIndex < current.length - 1; segmentIndex += 1) {
      const from = current[segmentIndex];
      const to = current[segmentIndex + 1];
      const priorFrom = previous[segmentIndex];
      const priorTo = previous[segmentIndex + 1];
      const dxFrom = from.x - priorFrom.x;
      const dyFrom = from.y - priorFrom.y;
      const dxTo = to.x - priorTo.x;
      const dyTo = to.y - priorTo.y;
      const motion = Math.hypot(dxFrom, dyFrom, dxTo, dyTo);
      if (motion < 0.004) continue;

      const segmentX = to.x - from.x;
      const segmentY = to.y - from.y;
      const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY || 1;
      for (let vertexIndex = 0; vertexIndex < clayPositions.count; vertexIndex += 1) {
        const vertexX = clayPositions.getX(vertexIndex);
        const vertexY = clayPositions.getY(vertexIndex);
        if (clayPositions.getZ(vertexIndex) < -0.02) continue;
        const along = THREE.MathUtils.clamp(((vertexX - from.x) * segmentX + (vertexY - from.y) * segmentY) / segmentLengthSquared, 0, 1);
        const nearestX = from.x + segmentX * along;
        const nearestY = from.y + segmentY * along;
        const distance = Math.hypot(vertexX - nearestX, vertexY - nearestY);
        if (distance >= radius) continue;
        const falloff = (1 - (distance / radius) ** 2) ** 2;
        const deltaX = THREE.MathUtils.clamp(THREE.MathUtils.lerp(dxFrom, dxTo, along) * 0.82, -0.075, 0.075);
        const deltaY = THREE.MathUtils.clamp(THREE.MathUtils.lerp(dyFrom, dyTo, along) * 0.82, -0.075, 0.075);
        const weightIndex = vertexIndex;
        accumulated[weightIndex * 3] += deltaX * falloff;
        accumulated[weightIndex * 3 + 1] += deltaY * falloff;
        accumulated[weightIndex * 3 + 2] += Math.min(0.055, Math.hypot(deltaX, deltaY) * 0.45) * falloff;
        weights[weightIndex] += falloff;
      }
    }
  }

  let changed = false;
  for (let vertexIndex = 0; vertexIndex < clayPositions.count; vertexIndex += 1) {
    const weight = weights[vertexIndex];
    if (!weight) continue;
    const x = clayPositions.getX(vertexIndex) + accumulated[vertexIndex * 3] / weight;
    const y = clayPositions.getY(vertexIndex) + accumulated[vertexIndex * 3 + 1] / weight;
    const z = clayPositions.getZ(vertexIndex) + accumulated[vertexIndex * 3 + 2] / weight;
    clayPositions.setXYZ(vertexIndex, x, y, z);
    changed = true;
  }
  if (changed) {
    clayPositions.needsUpdate = true;
    clayGeometry.computeVertexNormals();
    resetButton.hidden = false;
  }
  previousFingerPaths = currentPaths;
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
    // MediaPipe depth gets smaller as the hand moves toward the camera; Three.js uses +Z toward the camera.
    z: -point.z * 2.3,
  });
  const mappedPoints = smoothedPoints.map(pointAt);
  updateHandSurface(mappedPoints);
  scenePlaceholder.classList.add('is-hidden');
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
  const insideClay = Math.hypot(sculptPoint.x - clayCenter.x, sculptPoint.y - clayCenter.y) < clayRadius * 1.08;
  const cueLocal = clay.worldToLocal(sculptPoint.clone());
  cueLocal.z = Math.sqrt(Math.max(0, clayRadius * clayRadius - Math.min(cueLocal.x * cueLocal.x + cueLocal.y * cueLocal.y, clayRadius * clayRadius))) + 0.1;
  pinchCue.position.copy(clay.localToWorld(cueLocal));
  pinchCue.visible = pinchActive;
  pinchCue.scale.setScalar(pinchActive ? 1.12 : 0.8);
  deformAlongFingerPaths(mappedPoints, pinchActive && insideClay);
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
  tipHeading.textContent = 'Hand in view';
  tipCopy.textContent = 'Bring your fingertips over the clay, pinch gently, then trace a small curve.';
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
  previousFingerPaths = null;
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
    previousFingerPaths = null;
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
    previousFingerPaths = null;
    document.querySelector('#session-label').textContent = 'YOUR FIRST SESSION';
    mouseButton.textContent = 'Preview with mouse';
    return;
  }
  stopCamera();
  mouseMode = true;
  setStatus('ready', 'MOUSE SCULPTING');
  landmarkCount.textContent = '21 LANDMARKS · MOUSE';
  scenePlaceholder.classList.add('is-hidden');
  stageCaption.textContent = 'MOUSE SCULPTING · DRAG TO SHAPE';
  sceneHint.innerHTML = '<span class="hint-icon">✦</span> Move over the clay, then click and drag';
  setPrompt('Mouse sculpting is ready.', 'Move over the clay, then click and drag to shape it. Release to stop.', 'success');
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

resetButton.addEventListener('pointerdown', (event) => event.stopPropagation());
resetButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resetClay();
});

window.addEventListener('beforeunload', () => {
  stopCamera();
  cancelAnimationFrame(animationFrame);
});
