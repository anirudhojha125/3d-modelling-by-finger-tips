// main.js
// ---------------------------------------------------------------------------
// App initialization and the real-time loop.
//
// Pipeline (per frame):
//   webcam frame -> MediaPipe HandLandmarker -> 21 landmarks
//   -> DepthEstimator.estimate()  -> 3D world position
//   -> GestureRecognizer.classify() -> pinch / open-palm
//   -> gesture state machine -> BlockManager.spawn() / deleteNearest()
//   -> Three.js render
//
// The gesture state machine uses rising-edge latches so that one pinch spawns
// exactly one cube, and one held open palm deletes exactly one cube (until the
// hand closes and re-opens).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { DepthEstimator } from './depthEstimator.js';
import { GestureRecognizer, HAND_CONNECTIONS } from './gestureRecognizer.js';
import { BlockManager } from './blockManager.js';

// ---------------------------------------------------------------------------
// Configuration (tweakable at runtime via the UI sliders in index.html).
// ---------------------------------------------------------------------------
const config = {
    pinchThreshold: 0.05,    // normalized thumb-index distance to count as pinch
    openPalmMinFingers: 4,   // non-thumb fingers extended for "open palm"
    openPalmHoldMs: 300,     // how long the open palm must be held to delete
    depth: {
        nearPalmWidth: 220,    // px palm width -> depth 0 (near camera)
        farPalmWidth: 70,      // px palm width -> depth 1 (far from camera)
    },
    // Workspace volume (world units) that the hand maps into.
    workspace: { width: 7, height: 4, nearZ: 2, farZ: -3 },
    blockSize: 1,
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const countEl = document.getElementById('count');
const gestureEl = document.getElementById('gesture');
const depthEl = document.getElementById('depth');

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
);
camera.position.set(0, 1.6, 8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Mouse orbit so the user can inspect the structure (hands build, mouse views).
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 4;
controls.maxDistance = 16;

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 10, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.left = -8;
dirLight.shadow.camera.right = 8;
dirLight.shadow.camera.top = 8;
dirLight.shadow.camera.bottom = -8;
scene.add(dirLight);

// Floor + grid for spatial reference.
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x1a1f29, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.5;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(30, 30, 0x3a4252, 0x222831);
grid.position.y = -2.49;
scene.add(grid);

// Hand cursor: a small sphere showing where a pinch would spawn a block.
const cursor = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe066 })
);
cursor.visible = false;
scene.add(cursor);

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
const depthEstimator = new DepthEstimator(config);
const gestureRecognizer = new GestureRecognizer(config);
const blockManager = new BlockManager(scene, config);

// ---------------------------------------------------------------------------
// Gesture state machine
// ---------------------------------------------------------------------------
let pinchActive = false; // rising-edge latch: one spawn per pinch
let deleteArmed = true;  // one delete per open-palm hold

function handleGesture(gesture, worldPos) {
    const pos = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);

    // PINCH -> spawn one cube per new pinch (rising edge).
    if (gesture.isPinch) {
        if (!pinchActive) {
            pinchActive = true;
            blockManager.spawn(pos);
        }
    } else {
        pinchActive = false; // re-arm for the next pinch
    }

    // OPEN PALM (held) -> delete the nearest cube, once per hold.
    if (gesture.openPalmHeld) {
        if (deleteArmed) {
            blockManager.deleteNearest(pos);
            deleteArmed = false;
        }
    } else {
        deleteArmed = true; // re-arm when the hand closes again
    }
}

// ---------------------------------------------------------------------------
// MediaPipe HandLandmarker
// ---------------------------------------------------------------------------
let handLandmarker = null;

const WASM_URL =
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm';
const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function initHandLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate) =>
        HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
        });
    try {
        handLandmarker = await create('GPU');
    } catch (err) {
        console.warn('GPU delegate unavailable, falling back to CPU.', err);
        handLandmarker = await create('CPU');
    }
}

// ---------------------------------------------------------------------------
// Webcam
// ---------------------------------------------------------------------------
async function initCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
    });
    video.srcObject = stream;
    await video.play();
    // Match the overlay resolution to the real video resolution.
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
}

// ---------------------------------------------------------------------------
// Overlay drawing (landmarks + gesture-colored skeleton)
// ---------------------------------------------------------------------------
function drawOverlay(landmarks, gesture) {
    octx.clearRect(0, 0, overlay.width, overlay.height);

    const color = gesture.isPinch
        ? '#ffd166'
        : gesture.openPalmHeld
            ? '#ff5c5c'
            : '#5ce1e6';

    // Skeleton connections.
    octx.lineWidth = 3;
    octx.strokeStyle = color;
    octx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
        octx.moveTo(landmarks[a].x * overlay.width, landmarks[a].y * overlay.height);
        octx.lineTo(landmarks[b].x * overlay.width, landmarks[b].y * overlay.height);
    }
    octx.stroke();

    // Landmark points.
    octx.fillStyle = '#ffffff';
    for (const p of landmarks) {
        octx.beginPath();
        octx.arc(p.x * overlay.width, p.y * overlay.height, 3, 0, Math.PI * 2);
        octx.fill();
    }
}

function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
}

// ---------------------------------------------------------------------------
// HUD update
// ---------------------------------------------------------------------------
function updateHUD(gesture, worldPos) {
    let label = 'Idle';
    if (gesture.openPalmHeld) label = 'DELETE ✋';
    else if (gesture.isOpenPalm) label = 'Open palm…';
    else if (gesture.isPinch) label = 'PINCH 🤏';
    gestureEl.textContent = label;
    countEl.textContent = blockManager.count();
    depthEl.textContent = `${worldPos.depth.toFixed(2)} (z=${worldPos.z.toFixed(2)})`;
}

// ---------------------------------------------------------------------------
// UI control binding (sliders)
// ---------------------------------------------------------------------------
function bindSlider(id, valueId, applyFn, format = (v) => v) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valueId);
    const update = () => {
        const v = parseFloat(el.value);
        applyFn(v);
        valEl.textContent = format(v);
    };
    el.addEventListener('input', update);
    update();
}

function bindControls() {
    bindSlider('s-pinch', 'v-pinch',
        (v) => { config.pinchThreshold = v; gestureRecognizer.setPinchThreshold(v); },
        (v) => v.toFixed(2));
    bindSlider('s-hold', 'v-hold',
        (v) => { config.openPalmHoldMs = v; gestureRecognizer.setOpenPalmHoldMs(v); },
        (v) => `${v | 0}ms`);
    bindSlider('s-near', 'v-near',
        (v) => depthEstimator.setNear(v),
        (v) => `${v | 0}px`);
    bindSlider('s-far', 'v-far',
        (v) => depthEstimator.setFar(v),
        (v) => `${v | 0}px`);
    bindSlider('s-size', 'v-size',
        (v) => { config.blockSize = v; blockManager.setBlockSize(v); },
        (v) => v.toFixed(1));

    document.getElementById('btn-clear').addEventListener('click', () => blockManager.clear());
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;

function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;

    // FPS counter (averaged over ~500ms).
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 500) {
        fpsEl.textContent = (1000 / (fpsAccum / fpsFrames)).toFixed(0);
        fpsAccum = 0;
        fpsFrames = 0;
    }

    // Hand tracking + gesture handling.
    if (handLandmarker && video.readyState >= 2) {
        const result = handLandmarker.detectForVideo(video, now);
        if (result.landmarks && result.landmarks.length > 0) {
            const landmarks = result.landmarks[0];
            const worldPos = depthEstimator.estimate(landmarks, video.videoWidth, video.videoHeight);
            const gesture = gestureRecognizer.classify(landmarks, now);

            handleGesture(gesture, worldPos);

            // Move + color the cursor to reflect the current gesture.
            cursor.position.set(worldPos.x, worldPos.y, worldPos.z);
            cursor.visible = true;
            cursor.material.color.set(
                gesture.isPinch ? 0xffd166 : gesture.openPalmHeld ? 0xff5c5c : 0xffe066
            );

            drawOverlay(landmarks, gesture);
            updateHUD(gesture, worldPos);
        } else {
            // No hand visible.
            cursor.visible = false;
            clearOverlay();
            gestureRecognizer.reset();
            gestureEl.textContent = 'No hand';
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
    statusEl.textContent = 'Loading hand model…';
    try {
        await initHandLandmarker();
        statusEl.textContent = 'Starting camera…';
        await initCamera();
        statusEl.textContent = 'Ready ✅  Pinch to create · Open palm to delete';
        bindControls();
        requestAnimationFrame(loop);
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Error: ' + err.message;
    }
}

main();
