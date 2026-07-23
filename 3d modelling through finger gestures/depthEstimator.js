// depthEstimator.js — rough monocular depth + 3D position from a single 2D hand.
// Palm width (px) is inversely proportional to distance; mapped to a workspace volume.

function dist2D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

export class DepthEstimator {
    /**
     * @param {object} config
     * @param {object} config.depth        { nearPalmWidth, farPalmWidth } in pixels
     * @param {object} config.workspace    { width, height, nearZ, farZ } world units
     */
    constructor(config) {
        this.nearPalmWidth = config.depth.nearPalmWidth; // px -> depth 0 (near)
        this.farPalmWidth = config.depth.farPalmWidth;   // px -> depth 1 (far)
        this.workspace = config.workspace;
    }

    setNear(v) { this.nearPalmWidth = v; }
    setFar(v) { this.farPalmWidth = v; }

    /**
     * Estimate the 3D world position of the hand.
     * @param {Array<{x:number,y:number,z:number}>} landmarks  21 MediaPipe landmarks (normalized 0..1)
     * @param {number} videoWidth
     * @param {number} videoHeight
     * @returns {{x:number,y:number,z:number,depth:number,palmWidth:number}}
     */
    estimate(landmarks, videoWidth, videoHeight) {
        // Palm width in pixels (convert normalized -> pixel space for a stable metric).
        const p5 = { x: landmarks[5].x * videoWidth, y: landmarks[5].y * videoHeight };
        const p17 = { x: landmarks[17].x * videoWidth, y: landmarks[17].y * videoHeight };
        const palmWidth = dist2D(p5, p17);

        // Inverse mapping: big palm (close) -> 0, small palm (far) -> 1.
        const t = clamp(
            (this.nearPalmWidth - palmWidth) / (this.nearPalmWidth - this.farPalmWidth),
            0,
            1
        );

        // Hand center: middle-finger MCP (landmark 9) is a stable anchor point.
        const cx = landmarks[9].x;
        const cy = landmarks[9].y;

        // Mirror X so on-screen motion matches the mirrored webcam preview.
        const nx = 1 - cx;
        const ny = cy;

        // Unproject into the workspace volume.
        const worldX = (nx - 0.5) * this.workspace.width;
        const worldY = (0.5 - ny) * this.workspace.height; // flip Y (image top -> world up)
        const worldZ = lerp(this.workspace.nearZ, this.workspace.farZ, t);

        return { x: worldX, y: worldY, z: worldZ, depth: t, palmWidth };
    }
}
