import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PictostlApiError, PictostlClient } from '../src/client.js';

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('PictostlClient', () => {
  it('appends API key settings URL for INVALID_API_KEY', async () => {
    const client = new PictostlClient({
      apiKey: 'bad-key',
      fetchImpl: async () =>
        jsonResponse(401, {
          ok: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'A valid API key is required.',
          },
        }),
    });

    await assert.rejects(
      () => client.getAccount(),
      (error: unknown) => {
        assert.ok(error instanceof PictostlApiError);
        assert.equal(error.errorCode, 'INVALID_API_KEY');
        assert.equal(error.status, 401);
        assert.match(error.message, /settings\/api-keys/);
        return true;
      },
    );
  });

  it('appends pricing URL for INSUFFICIENT_CREDITS', async () => {
    const client = new PictostlClient({
      apiKey: 'test-key',
      fetchImpl: async () =>
        jsonResponse(409, {
          ok: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Not enough credits for this generation.',
          },
        }),
    });

    await assert.rejects(
      () =>
        client.createGeneration({
          imageAssetIds: ['a'],
          mode: 'single',
          quality: 'Basic',
          texture: 'None',
        }),
      (error: unknown) => {
        assert.ok(error instanceof PictostlApiError);
        assert.equal(error.errorCode, 'INSUFFICIENT_CREDITS');
        assert.equal(error.status, 409);
        assert.match(error.message, /https:\/\/pictostl\.com\/pricing/);
        return true;
      },
    );
  });

  it('uploads via intent, PUT without Bearer, then complete', async () => {
    const calls: Array<{
      url: string;
      method: string;
      authorization: string | null;
      contentType: string | null;
    }> = [];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const client = new PictostlClient({
      apiKey: 'ps_live_test',
      apiBase: 'https://pictostl.com',
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method ?? 'GET',
          authorization: headers.get('Authorization'),
          contentType: headers.get('Content-Type'),
        });
        if (url.endsWith('/uploads/intents')) {
          return jsonResponse(201, {
            ok: true,
            data: {
              id: 'asset_1',
              uploadUrl: 'https://r2.example/put/asset_1',
              headers: { 'Content-Type': 'image/png' },
              maxBytes: 10485760,
            },
          });
        }
        if (url === 'https://r2.example/put/asset_1') {
          return new Response(null, { status: 200 });
        }
        if (url.endsWith('/uploads/asset_1/complete')) {
          return jsonResponse(200, {
            ok: true,
            data: {
              id: 'asset_1',
              filename: 'front.png',
              mimeType: 'image/png',
              sizeBytes: png.byteLength,
              width: 8,
              height: 8,
            },
          });
        }
        throw new Error(`unexpected ${init?.method} ${url}`);
      },
    });

    const uploaded = (await client.uploadImage(
      png,
      'front.png',
      'image/png',
    )) as Record<string, unknown>;

    assert.equal(uploaded.id, 'asset_1');
    assert.equal(uploaded.assetId, 'asset_1');
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.method, 'POST');
    assert.match(calls[0]!.url, /\/api\/v1\/uploads\/intents$/);
    assert.equal(calls[0]?.authorization, 'Bearer ps_live_test');
    assert.equal(calls[1]?.method, 'PUT');
    assert.equal(calls[1]?.url, 'https://r2.example/put/asset_1');
    assert.equal(calls[1]?.authorization, null);
    assert.equal(calls[1]?.contentType, 'image/png');
    assert.equal(calls[2]?.method, 'POST');
    assert.match(calls[2]!.url, /\/api\/v1\/uploads\/asset_1\/complete$/);
    assert.equal(calls[2]?.authorization, 'Bearer ps_live_test');
  });

  it('does not forward Bearer when following a 307 to another host', async () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
    const auths: Array<{ url: string; authorization: string | null }> = [];
    const client = new PictostlClient({
      apiKey: 'ps_live_test',
      apiBase: 'https://pictostl.com',
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        auths.push({ url, authorization: headers.get('Authorization') });
        if (url.includes('/api/v1/assets/task-1')) {
          return new Response(null, {
            status: 307,
            headers: {
              Location: 'https://cdn.r2.example/models/task-1/model.glb?sig=1',
            },
          });
        }
        if (url.startsWith('https://cdn.r2.example/')) {
          return new Response(glb, {
            status: 200,
            headers: { 'Content-Type': 'model/gltf-binary' },
          });
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    const bytes = await client.downloadGlb('task-1');
    assert.deepEqual(bytes, glb);
    assert.equal(auths.length, 2);
    assert.equal(auths[0]?.authorization, 'Bearer ps_live_test');
    assert.equal(auths[1]?.authorization, null);
  });
});
