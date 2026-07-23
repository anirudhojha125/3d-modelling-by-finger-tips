// main.js — app init + real-time loop.
// Pipeline: webcam -> MediaPipe HandLandmarker -> DepthEstimator + GestureRecognizer -> BlockManager -> Three.js render.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { DepthEstimator } from './depthEstimator.js';
import { GestureRecognizer, HAND_CONNECTIONS } from './gestureRecognizer.js';
import { BlockManager } from './blockManager.js';

// Runtime-tweakable config (bound to the UI sliders in index.html).
const config = {
    pinchThreshold: 0.05,
    openPalmMinFingers: 4,
    openPalmHoldMs: 300,
    depth: { nearPalmWidth: 220, farPalmWidth: 70 },
    workspace: { width: 7, height: 4, nearZ: 2, farZ: -3 },
    blockSize: 1,
};

// DOM references.
const canvas = document.getElementById('scene');
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const countEl = document.getElementById('count');
const gestureEl = document.getElementById('gesture');
const depthEl = document.getElementById('depth');

// --- Three.js scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Mouse orbit (hands build, mouse views).
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 4;
controls.maxDistance = 16;

// Lights.
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

// Hand cursor: small sphere showing where a pinch would spawn a block.
const cursor = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe066 })
);
cursor.visible = false;
scene.add(cursor);

// --- Modules ---
const depthEstimator = new DepthEstimator(config);
const gestureRecognizer = new GestureRecognizer(config);
const blockManager = new BlockManager(scene, config);

// --- Gesture state machine (rising-edge latches: one action per gesture) ---
let pinchActive = false;
let deleteArmed = true;

function handleGesture(gesture, worldPos) {
    const pos = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);

    // PINCH -> spawn one cube per new pinch.
    if (gesture.isPinch) {
        if (!pinchActive) {
            pinchActive = true;
            blockManager.spawn(pos);
        }
    } else {
        pinchActive = false;
    }

    // OPEN PALM (held) -> delete nearest cube, once per hold.
    if (gesture.openPalmHeld) {
        if (deleteArmed) {
            blockManager.deleteNearest(pos);
            deleteArmed = false;
        }
    } else {
        deleteArmed = true;
    }
}

// --- MediaPipe HandLandmarker ---
let handLandmarker = null;

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm';
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

// --- Webcam ---
// Waits for video metadata so videoWidth/Height are non-zero before sizing the overlay.
async function initCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
    });
    video.srcObject = stream;
    await video.play();
    // Guard: if metadata already fired, resolve immediately; otherwise wait once.
    if (video.readyState >= 1 && video.videoWidth > 0) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        return;
    }
    await new Promise((resolve) => {
        video.onloadedmetadata = () => {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
            resolve();
        };
    });
}

// --- Overlay drawing (landmarks + gesture-colored skeleton) ---
function drawOverlay(landmarks, gesture) {
    octx.clearRect(0, 0, overlay.width, overlay.height);

    const color = gesture.isPinch
        ? '#ffd166'
        : gesture.openPalmHeld
            ? '#ff5c5c'
            : '#5ce1e6';

    octx.lineWidth = 3;
    octx.strokeStyle = color;
    octx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
        octx.moveTo(landmarks[a].x * overlay.width, landmarks[a].y * overlay.height);
        octx.lineTo(landmarks[b].x * overlay.width, landmarks[b].y * overlay.height);
    }
    octx.stroke();

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

// --- HUD update ---
function updateHUD(gesture, worldPos) {
    let label = 'Idle';
    if (gesture.openPalmHeld) label = 'DELETE ✋';
    else if (gesture.isOpenPalm) label = 'Open palm…';
    else if (gesture.isPinch) label = 'PINCH 🤏';
    gestureEl.textContent = label;
    countEl.textContent = blockManager.count();
    depthEl.textContent = `${worldPos.depth.toFixed(2)} (z=${worldPos.z.toFixed(2)})`;
}

// --- Manual block placement (no camera needed) ---
// Spawns a block just in front of the camera, slightly offset on each call so
// repeated clicks don't stack them exactly on top of each other.
function spawnBlockInFront() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const pos = camera.position.clone().add(dir.multiplyScalar(4));
    // Small scattered offset for variety.
    pos.x += (Math.random() - 0.5) * 1.5;
    pos.y += (Math.random() - 0.5) * 1.5;
    blockManager.spawn(pos);
    countEl.textContent = blockManager.count();
}

// --- UI control binding (sliders) ---
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

    document.getElementById('btn-add').addEventListener('click', () => {
        spawnBlockInFront();
    });
    document.getElementById('btn-delete').addEventListener('click', () => {
        blockManager.deleteLast();
        countEl.textContent = blockManager.count();
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
        blockManager.clear();
        countEl.textContent = blockManager.count();
    });
}

// --- Main loop ---
// Started immediately so the 3D scene (floor/grid/lights) always renders,
// even before — or if — the camera/model fail to load. This prevents the
// black screen that happened when init errors aborted the render loop.
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

    // Hand tracking + gesture handling (only when model + video are ready).
    if (handLandmarker && video.readyState >= 2 && video.videoWidth > 0) {
        const result = handLandmarker.detectForVideo(video, now);
        if (result.landmarks && result.landmarks.length > 0) {
            const landmarks = result.landmarks[0];
            const worldPos = depthEstimator.estimate(landmarks, video.videoWidth, video.videoHeight);
            const gesture = gestureRecognizer.classify(landmarks, now);

            handleGesture(gesture, worldPos);

            cursor.position.set(worldPos.x, worldPos.y, worldPos.z);
            cursor.visible = true;
            cursor.material.color.set(
                gesture.isPinch ? 0xffd166 : gesture.openPalmHeld ? 0xff5c5c : 0xffe066
            );

            drawOverlay(landmarks, gesture);
            updateHUD(gesture, worldPos);
        } else {
            cursor.visible = false;
            clearOverlay();
            gestureRecognizer.reset();
            gestureEl.textContent = 'No hand';
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

// --- Resize handling ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Boot ---
// The render loop starts right away; camera + model load in the background
// and report their own status. A failure in either no longer blanks the screen.
async function main() {
    requestAnimationFrame(loop);
    bindControls();

    statusEl.textContent = 'Loading hand model…';
    try {
        await initHandLandmarker();
    } catch (err) {
        console.error('Hand model init failed:', err);
        statusEl.textContent = '⚠️ Hand model failed: ' + err.message + ' — 3D scene still works.';
        return;
    }

    statusEl.textContent = 'Starting camera…';
    try {
        await initCamera();
        statusEl.textContent = 'Ready ✅  Pinch to create · Open palm to delete';
    } catch (err) {
        console.error('Camera init failed:', err);
        let hint = err.message;
        if (err.name === 'NotAllowedError') hint = 'Camera permission denied — allow access in your browser.';
        else if (err.name === 'NotFoundError') hint = 'No camera found on this device.';
        else if (location.protocol === 'file:') hint = 'Open via http://localhost:8000, not the file:// URL.';
        statusEl.textContent = '⚠️ Camera failed: ' + hint + ' — 3D scene still works.';
    }
}

main();
