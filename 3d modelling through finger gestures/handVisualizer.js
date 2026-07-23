// handVisualizer.js — renders a live 3D "virtual hand" in the Three.js scene
// from the 21 MediaPipe landmarks, plus two predictive aids so the user can
// see *before* acting:
//   • a translucent "ghost" block showing exactly where a pinch would spawn a cube
//   • a pulsing red wireframe box wrapping the block an open-palm would delete
//
// The skeleton is positioned by reusing the DepthEstimator's hand-center world
// position (landmark 9) and offsetting every other joint from it in normalized
// space, scaled into world units. This keeps the virtual hand glued to the
// same coordinate system the BlockManager spawns into.

import * as THREE from 'three';
import { HAND_CONNECTIONS } from './gestureRecognizer.js';

// Gesture -> skeleton color (matches the overlay canvas colors in main.js).
const COLOR_IDLE = 0x5ce1e6;
const COLOR_PINCH = 0xffd166;
const COLOR_DELETE = 0xff5c5c;

export class HandVisualizer {
    /**
     * @param {THREE.Scene} scene
     * @param {object} config
     * @param {object} config.workspace { width, height, nearZ, farZ } world units
     * @param {number} config.blockSize  edge length used for the ghost preview
     */
    constructor(scene, config) {
        this.scene = scene;
        this.workspace = config.workspace;
        this.blockSize = config.blockSize;

        // Scale that turns MediaPipe's relative landmark.z (≈ same units as x)
        // into a modest world-space depth offset so the hand isn't perfectly flat.
        this.zScale = (config.workspace.nearZ - config.workspace.farZ) * 0.4;

        // --- Skeleton group (21 joints + bones) ---
        this.group = new THREE.Group();
        this.group.visible = false;
        scene.add(this.group);

        this.jointGeo = new THREE.SphereGeometry(0.05, 10, 10);
        this.jointMat = new THREE.MeshBasicMaterial({ color: COLOR_IDLE });
        this.joints = [];
        for (let i = 0; i < 21; i++) {
            const m = new THREE.Mesh(this.jointGeo, this.jointMat);
            this.group.add(m);
            this.joints.push(m);
        }

        this.boneMat = new THREE.LineBasicMaterial({ color: COLOR_IDLE });
        this.bones = [];
        for (const [a, b] of HAND_CONNECTIONS) {
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(),
                new THREE.Vector3(),
            ]);
            const line = new THREE.Line(geo, this.boneMat);
            this.group.add(line);
            this.bones.push({ line, a, b });
        }

        // --- Ghost preview block (where a pinch would build) ---
        const ghostGeo = new THREE.BoxGeometry(1, 1, 1);
        this.ghostMat = new THREE.MeshBasicMaterial({
            color: COLOR_PINCH,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
        });
        this.ghost = new THREE.Mesh(ghostGeo, this.ghostMat);
        this.ghostEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(ghostGeo),
            new THREE.LineBasicMaterial({ color: COLOR_PINCH })
        );
        this.ghost.add(this.ghostEdges);
        this.ghost.visible = false;
        scene.add(this.ghost);

        // --- Delete highlight (wireframe box wrapping the doomed block) ---
        const hlGeo = new THREE.BoxGeometry(1, 1, 1);
        this.highlightMat = new THREE.MeshBasicMaterial({
            color: COLOR_DELETE,
            wireframe: true,
            transparent: true,
            opacity: 0.9,
        });
        this.deleteHighlight = new THREE.Mesh(hlGeo, this.highlightMat);
        this.deleteHighlight.visible = false;
        scene.add(this.deleteHighlight);

        // Reusable temp objects (avoid per-frame allocation).
        this._box = new THREE.Box3();
        this._size = new THREE.Vector3();
        this._center = new THREE.Vector3();
        this._elapsed = 0;
    }

    setBlockSize(v) {
        this.blockSize = v;
        this.ghost.scale.setScalar(v);
    }

    /**
     * Convert a normalized landmark into world space, relative to the hand
     * center (landmark 9) whose world position is already known.
     */
    _jointToWorld(lm, centerLm, handWorld, out) {
        // Mirrored X + flipped Y, matching DepthEstimator's mapping.
        const ox = (centerLm.x - lm.x) * this.workspace.width;
        const oy = (centerLm.y - lm.y) * this.workspace.height;
        // MediaPipe z: more negative = closer to camera -> larger world z (near).
        const oz = (centerLm.z - lm.z) * this.zScale;
        out.set(handWorld.x + ox, handWorld.y + oy, handWorld.z + oz);
    }

    /**
     * Drive the visualizer for one frame.
     * @param {Array} landmarks        21 MediaPipe landmarks (normalized)
     * @param {{x,y,z}} handWorld       world position of the hand center (landmark 9)
     * @param {object} gesture          output of GestureRecognizer.classify()
     * @param {BlockManager} blockManager  used to find the block an open-palm would delete
     * @param {number} dt               frame delta in ms (for pulse animation)
     */
    update(landmarks, handWorld, gesture, blockManager, dt) {
        this._elapsed += dt;
        this.group.visible = true;

        const centerLm = landmarks[9];
        const tmp = this._center; // reused as a scratch vector here

        // --- Joints ---
        for (let i = 0; i < 21; i++) {
            this._jointToWorld(landmarks[i], centerLm, handWorld, this.joints[i].position);
        }

        // --- Bones ---
        for (const bone of this.bones) {
            const pa = this.joints[bone.a].position;
            const pb = this.joints[bone.b].position;
            const pos = bone.line.geometry.attributes.position;
            pos.setXYZ(0, pa.x, pa.y, pa.z);
            pos.setXYZ(1, pb.x, pb.y, pb.z);
            pos.needsUpdate = true;
        }

        // --- Color the skeleton by current gesture ---
        const color = gesture.isPinch
            ? COLOR_PINCH
            : gesture.openPalmHeld
                ? COLOR_DELETE
                : COLOR_IDLE;
        this.jointMat.color.setHex(color);
        this.boneMat.color.setHex(color);

        // --- Ghost preview block (hide while a delete is primed) ---
        const showGhost = !gesture.isOpenPalm;
        this.ghost.visible = showGhost;
        if (showGhost) {
            this.ghost.position.set(handWorld.x, handWorld.y, handWorld.z);
            // Brighten + pulse as the pinch closes in.
            const pulse = 0.5 + 0.5 * Math.sin(this._elapsed * 0.006);
            this.ghostMat.opacity = gesture.isPinch ? 0.45 + 0.2 * pulse : 0.18 + 0.06 * pulse;
            this.ghostMat.color.setHex(gesture.isPinch ? COLOR_PINCH : COLOR_IDLE);
            this.ghostEdges.material.color.setHex(gesture.isPinch ? COLOR_PINCH : COLOR_IDLE);
        }

        // --- Delete highlight (the block an open palm would remove) ---
        if (gesture.isOpenPalm) {
            const target = blockManager.nearest(handWorld);
            if (target) {
                this._box.setFromObject(target);
                this._box.getSize(this._size);
                this._box.getCenter(this._center);
                // Wrap the block a touch larger so the wireframe reads clearly.
                this.deleteHighlight.scale.copy(this._size).multiplyScalar(1.12);
                this.deleteHighlight.position.copy(this._center);
                this.deleteHighlight.visible = true;
                // Pulse opacity: steady when held (about to fire), softer when just primed.
                const pulse = 0.5 + 0.5 * Math.sin(this._elapsed * 0.012);
                this.highlightMat.opacity = gesture.openPalmHeld ? 0.7 + 0.3 * pulse : 0.35 + 0.2 * pulse;
            } else {
                this.deleteHighlight.visible = false;
            }
        } else {
            this.deleteHighlight.visible = false;
        }
    }

    /** Hide everything (e.g. when the hand leaves the frame). */
    hide() {
        this.group.visible = false;
        this.ghost.visible = false;
        this.deleteHighlight.visible = false;
    }

    /** Free GPU resources. */
    dispose() {
        this.hide();
        this.scene.remove(this.group, this.ghost, this.deleteHighlight);
        this.jointGeo.dispose();
        this.jointMat.dispose();
        this.boneMat.dispose();
        for (const bone of this.bones) bone.line.geometry.dispose();
        this.ghost.geometry.dispose();
        this.ghostMat.dispose();
        this.ghostEdges.geometry.dispose();
        this.ghostEdges.material.dispose();
        this.deleteHighlight.geometry.dispose();
        this.highlightMat.dispose();
    }
}
