// blockManager.js — spawn / track / delete cubes in the Three.js scene.

import * as THREE from 'three';

// A pleasant, high-contrast palette so individual cubes are easy to tell apart.
const PALETTE = [
    0x4f93ff, 0xff7a5c, 0x6fe0a0, 0xffd166,
    0xb388ff, 0xff5ca8, 0x5ce1e6, 0xffb74d,
];

function randomColor() {
    return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

export class BlockManager {
    /**
     * @param {THREE.Scene} scene
     * @param {object} config
     * @param {number} config.blockSize  edge length of the cube (world units)
     */
    constructor(scene, config) {
        this.scene = scene;
        this.size = config.blockSize;
        /** @type {THREE.Mesh[]} */
        this.blocks = [];
    }

    setBlockSize(v) { this.size = v; }

    /**
     * Spawn a cube at the given world position.
     * @param {THREE.Vector3} position
     * @returns {THREE.Mesh}
     */
    spawn(position) {
        const size = this.size;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshStandardMaterial({
            color: randomColor(),
            roughness: 0.55,
            metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Black wireframe edges for a crisp block silhouette.
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0x111111 })
        );
        mesh.add(edges);

        this.scene.add(mesh);
        this.blocks.push(mesh);
        return mesh;
    }

    /**
     * Delete the block closest to the given position.
     * @param {THREE.Vector3} position
     * @returns {THREE.Mesh|null} the removed mesh, or null if none existed
     */
    deleteNearest(position) {
        if (this.blocks.length === 0) return null;

        let bestIndex = -1;
        let bestDist = Infinity;
        this.blocks.forEach((mesh, i) => {
            const d = mesh.position.distanceTo(position);
            if (d < bestDist) {
                bestDist = d;
                bestIndex = i;
            }
        });

        const mesh = this.blocks[bestIndex];
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.blocks.splice(bestIndex, 1);
        return mesh;
    }

    /**
     * Delete the most recently added block (no position needed).
     * @returns {THREE.Mesh|null} the removed mesh, or null if none existed
     */
    deleteLast() {
        if (this.blocks.length === 0) return null;
        const mesh = this.blocks.pop();
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        return mesh;
    }

    /** Remove every block and free its resources. */
    clear() {
        while (this.blocks.length) {
            const mesh = this.blocks.pop();
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
    }

    count() {
        return this.blocks.length;
    }
}
