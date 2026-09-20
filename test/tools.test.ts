import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { PictostlClient } from '../src/client.js';
import { capWaitSeconds, registerTools, TOOL_NAMES } from '../src/tools.js';

test('exports exactly seven tool names', () => {
  assert.deepEqual(TOOL_NAMES, [
    'list_generation_options',
    'upload_image',
    'generate_model',
    'get_task',
    'list_my_generations',
    'get_account',
    'download_model',
  ]);
});

test('waitSeconds is capped at 60', () => {
  assert.equal(capWaitSeconds(90), 60);
  assert.equal(capWaitSeconds(-1), 0);
  assert.equal(capWaitSeconds(15), 15);
});

test('registers seven tools with required descriptions', async () => {
  await withMcp({} as PictostlClient, async (mcp) => {
    const listed = await mcp.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      [...TOOL_NAMES],
    );
    const descriptions = Object.fromEntries(
      listed.tools.map((tool) => [tool.name, tool.description]),
    );
    assert.match(
      descriptions.get_task ?? '',
      /max 60|60 seconds/i,
    );
    assert.match(descriptions.get_task ?? '', /same id/i);
    assert.match(descriptions.generate_model ?? '', /clientRequestId/);
    assert.match(descriptions.download_model ?? '', /task id/i);
    assert.match(descriptions.download_model ?? '', /not an upload/i);
    assert.match(descriptions.download_model ?? '', /100 mm/);
    assert.doesNotMatch(JSON.stringify(listed.tools), /uploadUrl/);
  });
});

test('get_task polls queued then completed and stops early', async () => {
  let calls = 0;
  const client = {
    getGeneration: async (id: string) => {
      assert.equal(id, 'task-1');
      calls += 1;
      if (calls < 3) return { id, status: 'queued' };
      return { id, status: 'completed', modelUrl: 'https://pictostl.com/api/v1/assets/task-1?format=glb' };
    },
  } as unknown as PictostlClient;

  await withMcp(client, async (mcp) => {
    const started = Date.now();
    const result = await mcp.callTool({
      name: 'get_task',
      arguments: { id: 'task-1', waitSeconds: 60 },
    });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(textOf(result)) as { status: string };
    assert.equal(payload.status, 'completed');
    assert.equal(calls, 3);
    assert.ok(Date.now() - started < 10_000);
  });
});

test('generate_model sends a clientRequestId when the agent omits one', async () => {
  let body: Record<string, unknown> | undefined;
  const client = {
    createGeneration: async (input: Record<string, unknown>) => {
      body = input;
      return {
        id: 'task-9',
        clientRequestId: input.clientRequestId,
        status: 'queued',
      };
    },
  } as unknown as PictostlClient;

  await withMcp(client, async (mcp) => {
    const result = await mcp.callTool({
      name: 'generate_model',
      arguments: {
        imageAssetIds: ['asset_1'],
        mode: 'single',
        quality: 'Basic',
        texture: 'None',
      },
    });
    const payload = JSON.parse(textOf(result)) as {
      id: string;
      clientRequestId: string;
    };
    assert.equal(payload.id, 'task-9');
    assert.match(
      payload.clientRequestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(body?.clientRequestId, payload.clientRequestId);
  });
});

test('upload_image rejects paths that are not files', async () => {
  await withMcp({} as PictostlClient, async (mcp) => {
    const result = await mcp.callTool({
      name: 'upload_image',
      arguments: { path: os.tmpdir() },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not a file/i);
  });
});

test('download_model writes original GLB bytes and omits longestEdgeMm', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pictostl-mcp-'));
  const dest = path.join(dir, 'model.glb');
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
  const client = {
    downloadGlb: async (id: string) => {
      assert.equal(id, 'task-1');
      return glb;
    },
  } as unknown as PictostlClient;

  await withMcp(client, async (mcp) => {
    const result = await mcp.callTool({
      name: 'download_model',
      arguments: { id: 'task-1', path: dest, format: 'glb' },
    });
    const payload = JSON.parse(textOf(result)) as Record<string, unknown>;
    assert.equal(payload.format, 'glb');
    assert.equal(payload.bytes, 8);
    assert.equal('longestEdgeMm' in payload, false);
    const written = await readFile(dest);
    assert.deepEqual(written, Buffer.from(glb));
  });
});

test('upload_image returns assetId from a local file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pictostl-mcp-'));
  const filePath = path.join(dir, 'front.png');
  await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const client = {
    uploadImage: async (buffer: Uint8Array, filename: string, mimeType: string) => {
      assert.equal(filename, 'front.png');
      assert.equal(mimeType, 'image/png');
      assert.equal(buffer.byteLength, 4);
      return { id: 'asset_1', filename, mimeType };
    },
  } as unknown as PictostlClient;

  await withMcp(client, async (mcp) => {
    const result = await mcp.callTool({
      name: 'upload_image',
      arguments: { path: filePath },
    });
    const payload = JSON.parse(textOf(result)) as { assetId: string; id: string };
    assert.equal(payload.id, 'asset_1');
    assert.equal(payload.assetId, 'asset_1');
  });
});

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const item = result.content[0];
  assert.equal(item?.type, 'text');
  return item?.text ?? '';
}

async function withMcp(
  client: PictostlClient,
  fn: (mcp: Client) => Promise<void>,
) {
  const server = new McpServer({ name: 'pictostl', version: '0.1.0' });
  registerTools(server, client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    mcp.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    await fn(mcp);
  } finally {
    await mcp.close();
    await server.close();
  }
}
