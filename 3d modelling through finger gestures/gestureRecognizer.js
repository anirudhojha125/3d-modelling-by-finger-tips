// gestureRecognizer.js — pinch / open-palm classification from 21 MediaPipe landmarks.
// A finger is "extended" when its tip is farther from the wrist than its PIP joint (15% margin).

function dist2D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// MediaPipe hand landmark indices.
const WRIST = 0;
const TIP = [4, 8, 12, 16, 20];  // thumb, index, middle, ring, pinky tips
const PIP = [3, 6, 10, 14, 18];  // thumb IP, index/middle/ring/pinky PIP

export class GestureRecognizer {
    /**
     * @param {object} config
     * @param {number} config.pinchThreshold      normalized thumb-index distance
     * @param {number} config.openPalmMinFingers  non-thumb fingers that must be extended
     * @param {number} config.openPalmHoldMs      hold time before the delete fires
     */
    constructor(config) {
        this.pinchThreshold = config.pinchThreshold;
        this.openPalmMinFingers = config.openPalmMinFingers;
        this.openPalmHoldMs = config.openPalmHoldMs;
        this._openPalmSince = 0; // timestamp when open palm first detected
    }

    setPinchThreshold(v) { this.pinchThreshold = v; }
    setOpenPalmHoldMs(v) { this.openPalmHoldMs = v; }

    /** Reset hold timing (e.g. when the hand leaves the frame). */
    reset() {
        this._openPalmSince = 0;
    }

    /**
     * @param {Array} landmarks  21 landmarks
     * @returns {boolean[]}     [thumb, index, middle, ring, pinky] extended flags
     */
    extendedFingers(landmarks) {
        const wrist = landmarks[WRIST];
        const out = [];
        for (let i = 0; i < 5; i++) {
            const tipD = dist2D(landmarks[TIP[i]], wrist);
            const pipD = dist2D(landmarks[PIP[i]], wrist);
            out.push(tipD > pipD * 1.15); // 15% margin reduces flicker
        }
        return out;
    }

    /**
     * Classify the current frame.
     * @param {Array} landmarks  21 landmarks
     * @param {number} now       performance.now() timestamp (ms)
     * @returns {{isPinch:boolean, pinchDist:number, isOpenPalm:boolean,
     *           openPalmHeld:boolean, extendedCount:number, fingers:boolean[]}}
     */
    classify(landmarks, now) {
        // --- Pinch ---
        const pinchDist = dist2D(landmarks[4], landmarks[8]);
        const isPinch = pinchDist < this.pinchThreshold;

        // --- Open palm ---
        const fingers = this.extendedFingers(landmarks);
        const nonThumb = fingers.slice(1); // index, middle, ring, pinky
        const extendedCount = nonThumb.filter(Boolean).length;
        const isOpenPalm = extendedCount >= this.openPalmMinFingers;

        // Hold timing: only fire the delete after the pose is held continuously.
        if (isOpenPalm) {
            if (this._openPalmSince === 0) this._openPalmSince = now;
        } else {
            this._openPalmSince = 0;
        }
        const openPalmHeld =
            isOpenPalm && this._openPalmSince > 0 && (now - this._openPalmSince) >= this.openPalmHoldMs;

        return { isPinch, pinchDist, isOpenPalm, openPalmHeld, extendedCount, fingers };
    }
}

// Standard MediaPipe hand skeleton connections, used for the overlay drawing.
export const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
    [0, 5], [5, 6], [6, 7], [7, 8],          // index
    [5, 9], [9, 10], [10, 11], [11, 12],     // middle
    [9, 13], [13, 14], [14, 15], [15, 16],   // ring
    [13, 17], [17, 18], [18, 19], [19, 20],  // pinky
    [0, 17],                                  // palm base
];
