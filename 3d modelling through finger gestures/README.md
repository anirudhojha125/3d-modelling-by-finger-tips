# 🤏 Hand Gesture 3D Block Builder

A lightweight, browser-based "image recognition → 3D modelling" app. You create
and delete simple 3D cubes using **only hand gestures** captured from a webcam —
no mouse, keyboard, or backend required.

- **Pinch** (thumb + index finger together) → spawn a 1×1×1 cube at the pinch's
  3D location.
- **Open palm** (all fingers extended, held ~300 ms) → delete the cube nearest
  to the hand.
- Repeat to build simple structures out of cubes.

Everything runs in the browser: [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
for 2D hand tracking, a hand-size heuristic for rough monocular depth, and
[Three.js](https://threejs.org/) for the 3D scene.

---

## Project structure

```
index.html            UI: 3D canvas, HUD, tuning sliders, webcam preview
main.js               App init, Three.js scene, webcam + MediaPipe loop, gesture state machine
gestureRecognizer.js Hand tracking output → pinch / open-palm classification
blockManager.js       Spawn / track / delete cubes in the Three.js scene
depthEstimator.js     Rough 3D position inference from hand size + 2D location
README.md             This file
```

---

## How to run locally

Because the app uses ES modules + an import map (and loads the MediaPipe model
from a CDN), it must be served over **http://**, not opened as a `file://` URL.

Pick any one of these from the project folder:

```bash
# Option A — Python (already installed on most systems)
python -m http.server 8000

# Option B — Node
npx serve

# Option C — Node http-server
npx http-server -p 8000
```

Then open <http://localhost:8000> in Chrome/Edge (recommended for the GPU
WebGL delegate). Allow webcam access when prompted.

> The first load downloads the MediaPipe WASM + hand-landmarker model from a
> CDN, so you need an internet connection on first run.

---

## How it works (architecture)

```
webcam frame
   │
   ▼
MediaPipe HandLandmarker  ──►  21 normalized 2D landmarks (+ relative z)
   │
   ├──► DepthEstimator.estimate()
   │        palm width (px)  →  depth 0..1  (inverse size → distance)
   │        hand center (x,y) →  world X,Y   (mirrored, unprojected)
   │        depth             →  world Z
   │        ──► { x, y, z, depth, palmWidth }
   │
   ├──► GestureRecognizer.classify()
   │        thumb-index distance  →  pinch
   │        extended-finger count →  open palm (+ hold timer)
   │        ──► { isPinch, openPalmHeld, ... }
   │
   ▼
Gesture state machine (rising-edge latches)
   │  new pinch      → BlockManager.spawn(pos)      (one cube per pinch)
   │  open palm held → BlockManager.deleteNearest() (one delete per hold)
   ▼
Three.js render  (scene + shadows + grid floor + hand cursor)
```

### Key design decisions

- **MediaPipe Tasks Vision (`HandLandmarker`)** is used instead of the legacy
  `@mediapipe/hands` package: it is the current recommended API, ships a single
  bundle, and exposes 21 landmarks per hand with a `VIDEO` running mode that
  takes a monotonic timestamp (ideal for `requestAnimationFrame`).
- **Depth from hand size.** A learned monocular depth model would be heavy and
  slow. Instead we measure the palm width in pixels (distance between the index
  MCP and pinky MCP — stable regardless of finger curl) and map it inversely to
  depth. This is approximate but fast, tunable, and good enough for placing
  blocks in a small workspace.
- **Orientation-independent finger extension.** A finger is "extended" when its
  tip is farther from the wrist than its PIP joint (with a 15 % margin). This
  works for any hand orientation, unlike naive "tip above PIP" tests.
- **Rising-edge latches** in the state machine guarantee one action per gesture:
  one pinch = one cube; one held open palm = one deletion (re-armed only after
  the hand closes). This prevents accidental machine-gun spawning/deleting.
- **Mouse orbit + hand building.** `OrbitControls` lets you inspect the scene
  with the mouse while your hands build — the two input modes don't conflict.
- **Live tuning UI.** All thresholds are exposed as sliders so you can calibrate
  for your camera/lighting without editing code.

---

## Gestures — definition & tuning

| Gesture      | Detection                                              | Action   |
|--------------|--------------------------------------------------------|----------|
| **Pinch**    | distance(thumb tip 4, index tip 8) < `pinchThreshold` | spawn    |
| **Open palm**| ≥ `openPalmMinFingers` non-thumb fingers extended, held ≥ `openPalmHoldMs` | delete nearest |

Use the **Gesture Tuning** panel (top-right) to adjust live:

| Slider           | What it controls                                            | Typical values |
|------------------|-------------------------------------------------------------|----------------|
| Pinch threshold  | How close thumb+index must be to register a pinch (normalized 0–1) | 0.04 – 0.07 |
| Open-palm hold   | How long the open palm must be held before a delete fires   | 200 – 400 ms   |
| Near palm width  | Palm width in px that maps to the *nearest* plane (depth 0)  | 180 – 260 px   |
| Far palm width   | Palm width in px that maps to the *farthest* plane (depth 1) | 50 – 100 px    |
| Block size       | Edge length of spawned cubes (world units)                 | 0.7 – 1.5      |

### Calibrating depth for your setup

1. Hold your hand **close** to the camera and note the **Depth** value in the
   HUD — it should read ~`0.00`. If not, lower *Near palm width* until it does.
2. Move your hand **far** from the camera — Depth should approach ~`1.00`. If
   it saturates early, lower *Far palm width*.
3. The yellow sphere (hand cursor) shows the exact 3D spawn point in real time,
   so you can verify depth feels right before pinching.

### Testing gestures

- The webcam preview (bottom-right) draws the hand skeleton; it turns
  **yellow** on pinch and **red** when a delete fires — handy for verifying
  detection.
- The HUD shows the current gesture label, block count, depth, and FPS.
- Aim for ≥ 30 FPS on a typical laptop. If FPS is low, the app automatically
  falls back from the GPU to the CPU MediaPipe delegate; you can also lower
  the webcam resolution in `main.js` (`initCamera`).

---

## How to extend

### More shapes

`blockManager.js` is the only place that creates geometry. To add shapes, give
`spawn()` a `type` argument and branch on it:

```js
spawn(position, type = 'cube') {
  let geometry;
  switch (type) {
    case 'sphere': geometry = new THREE.SphereGeometry(this.size / 2, 24, 16); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(this.size/2, this.size/2, this.size, 24); break;
    default: geometry = new THREE.BoxGeometry(this.size, this.size, this.size);
  }
  // ...rest unchanged (material, edges, mesh, scene.add)
}
```

Then map a second gesture (e.g. "peace ✌️" → sphere) in `gestureRecognizer.js`
and pass the chosen type from `main.js`.

### More gestures

Add a method to `gestureRecognizer.js`, e.g.:

```js
isPeace(landmarks) {
  // index + middle extended, ring + pinky curled
  const f = this.extendedFingers(landmarks);
  return f[1] && f[2] && !f[3] && !f[4];
}
```

Return it from `classify()` and handle it in `handleGesture()` in `main.js`.
Use the same rising-edge latch pattern to trigger an action once per pose.

### Better depth

- Replace the hand-size heuristic in `depthEstimator.js` with a learned
  monocular depth model (e.g. MediaPipe Depth, MiDaS via ONNX Runtime Web) and
  sample the depth map at the hand center.
- If a depth camera (e.g. RGBD) is available, read its depth stream directly
  instead of estimating.
- Stereo cues: if you have two webcams, triangulate the hand center for true 3D.

### Persistence / export

- Serialize `blockManager.blocks` (positions + colors) to JSON for save/load.
- Export the scene to `.glb` with `GLTFExporter` from `three/addons/exporters/`.

---

## Troubleshooting

- **Black screen / "Error: …"** — make sure you opened the app via
  `http://localhost:8000`, not by double-clicking the HTML file.
- **No webcam / permission denied** — allow camera access for that origin in
  your browser settings, and ensure no other app is using the camera.
- **Model won't load** — you need internet on first run (CDN model download).
- **Low FPS** — the app falls back to CPU automatically; you can also reduce
  the webcam resolution in `initCamera()` inside `main.js`.
