import assert from 'node:assert/strict';
import test from 'node:test';

import { glbToBinaryStl } from '../src/stl.js';

test('binary STL longest edge matches longestEdgeMm', async () => {
  const glb = triangleGlb();
  const stl100 = await glbToBinaryStl(glb, 100);
  const stl50 = await glbToBinaryStl(glb, 50);
  const long100 = longestEdge(stlBounds(stl100));
  const long50 = longestEdge(stlBounds(stl50));
  assert.ok(Math.abs(long100 - 100) < 0.01, `expected ~100mm, got ${long100}`);
  assert.ok(Math.abs(long50 - 50) < 0.01, `expected ~50mm, got ${long50}`);
  assert.ok(Math.abs(long50 / long100 - 0.5) < 0.01);
});

test('fixture GLB has the glTF magic', () => {
  const glb = triangleGlb();
  assert.equal(glb.byteLength > 0, true);
  assert.equal(String.fromCharCode(...glb.subarray(0, 4)), 'glTF');
});

/** Right triangle with bbox 2 × 1 × 0 so the longest edge is 2. */
function triangleGlb() {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const bin = new Uint8Array(44);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), 36);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [2, 1, 0],
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    buffers: [{ byteLength: 44 }],
  });
  const jsonBytes = pad4(new TextEncoder().encode(json), 0x20);
  const binBytes = pad4(bin, 0);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.byteLength;
  view.setUint32(binHeader, binBytes.byteLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  out.set(binBytes, binHeader + 8);
  return out;
}

function pad4(bytes: Uint8Array, fill: number) {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  padded.fill(fill);
  padded.set(bytes);
  return padded;
}

function stlBounds(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12;
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    offset += 2;
  }
  return { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ };
}

function longestEdge(bounds: { dx: number; dy: number; dz: number }) {
  return Math.max(bounds.dx, bounds.dy, bounds.dz);
}
