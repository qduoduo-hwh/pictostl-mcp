import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export const DEFAULT_LONGEST_EDGE_MM = 100;
export const MIN_LONGEST_EDGE_MM = 1;
export const MAX_LONGEST_EDGE_MM = 1000;
export function normalizeLongestEdgeMm(value) {
    if (value == null || value === '')
        return DEFAULT_LONGEST_EDGE_MM;
    const n = Number(value);
    if (!Number.isFinite(n) || n < MIN_LONGEST_EDGE_MM || n > MAX_LONGEST_EDGE_MM) {
        throw new Error(`longestEdgeMm must be between ${MIN_LONGEST_EDGE_MM} and ${MAX_LONGEST_EDGE_MM}`);
    }
    return n;
}
export async function glbToBinaryStl(glb, longestEdgeMm = DEFAULT_LONGEST_EDGE_MM) {
    // GLTFLoader uses the Web Worker global `self` when resolving embedded
    // textures. Node exposes the required URL/Blob APIs on globalThis, but does
    // not define that alias. STL export ignores textures, so this compatibility
    // alias is sufficient and lets textured GLBs load without a browser DOM.
    if (!('self' in globalThis)) {
        Object.defineProperty(globalThis, 'self', {
            value: globalThis,
            configurable: true,
        });
    }
    const size = normalizeLongestEdgeMm(longestEdgeMm);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const copy = new Uint8Array(glb.byteLength);
    copy.set(glb);
    const gltf = await loader.parseAsync(copy.buffer, '');
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const extent = box.getSize(new THREE.Vector3());
    const longest = Math.max(extent.x, extent.y, extent.z);
    if (!Number.isFinite(longest) || longest <= 0) {
        throw new Error('Model has no usable geometry');
    }
    root.scale.multiplyScalar(size / longest);
    root.updateMatrixWorld(true);
    const parsed = new STLExporter().parse(root, { binary: true });
    if (!(parsed instanceof DataView)) {
        throw new Error('STL export failed');
    }
    return new Uint8Array(parsed.buffer, parsed.byteOffset, parsed.byteLength);
}
export async function writeGlbFile(filePath, glb) {
    await writeFile(filePath, glb);
    return glb.byteLength;
}
export async function writeStlFile(filePath, glb, longestEdgeMm) {
    const size = normalizeLongestEdgeMm(longestEdgeMm);
    const stl = await glbToBinaryStl(glb, size);
    await writeFile(filePath, stl);
    return { bytes: stl.byteLength, longestEdgeMm: size };
}
