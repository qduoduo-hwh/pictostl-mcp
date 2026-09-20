import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { PictostlApiError, type PictostlClient } from './client.js';
import { writeGlbFile, writeStlFile } from './stl.js';

export const TOOL_NAMES = [
  'list_generation_options',
  'upload_image',
  'generate_model',
  'get_task',
  'list_my_generations',
  'get_account',
  'download_model',
] as const;

const POLL_INTERVAL_MS = 2_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed']);
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function capWaitSeconds(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 60);
}

export function resolveClientRequestId(value?: string) {
  const trimmed = value?.trim();
  return trimmed || randomUUID();
}

export function registerTools(server: McpServer, client: PictostlClient): void {
  server.registerTool(
    'list_generation_options',
    {
      description:
        'List pictostl.com generation options available to API clients: quality (Basic/Pro/Ultra), texture, single vs multi-view rules, and credit costs.',
    },
    async () => runTool(() => client.listOptions()),
  );

  server.registerTool(
    'upload_image',
    {
      description:
        'Upload a local image file or HTTPS URL and return an assetId for generate_model. Do not pass this id to download_model or get_task.',
      inputSchema: {
        path: z.string().optional().describe('Local filesystem path to an image file'),
        url: z.string().optional().describe('HTTPS URL of an image'),
      },
    },
    async (args) => runTool(() => uploadImage(client, args.path, args.url)),
  );

  server.registerTool(
    'generate_model',
    {
      description:
        'Start an async image-to-3D job on pictostl.com. Requires imageAssetIds from upload_image. If you omit clientRequestId the server call still sends one — reuse that value to retry the same job without a second charge. Poll with get_task using the returned task id.',
      inputSchema: {
        imageAssetIds: z
          .array(z.string())
          .min(1)
          .describe('Asset IDs returned by upload_image'),
        mode: z.enum(['single', 'multi']),
        quality: z.enum(['Basic', 'Pro', 'Ultra']),
        texture: z.enum(['None', 'Standard', 'HD']),
        views: z
          .array(z.enum(['Front', 'Left', 'Back', 'Right']))
          .optional()
          .describe('Required for Pro/Ultra multi-view; must include Front'),
        clientRequestId: z
          .string()
          .optional()
          .describe('UUID for idempotent retries; generated when omitted'),
      },
    },
    async (args) =>
      runTool(async () => {
        const clientRequestId = resolveClientRequestId(args.clientRequestId);
        const data = await client.createGeneration({
          imageAssetIds: args.imageAssetIds,
          mode: args.mode,
          quality: args.quality,
          texture: args.texture,
          views: args.views,
          clientRequestId,
        });
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const record = data as Record<string, unknown>;
          return {
            ...record,
            id: record.id,
            clientRequestId:
              typeof record.clientRequestId === 'string'
                ? record.clientRequestId
                : clientRequestId,
          };
        }
        return { clientRequestId, data };
      }),
  );

  server.registerTool(
    'get_task',
    {
      description:
        'Fetch a generation by task id (not an upload assetId). Optional waitSeconds (max 60) polls until completed or failed. Jobs often take longer than 60 seconds — call again with the same id until it is completed or failed.',
      inputSchema: {
        id: z.string().describe('Task id from generate_model'),
        waitSeconds: z
          .number()
          .optional()
          .describe('Seconds to poll for a terminal status (max 60)'),
      },
    },
    async (args) =>
      runTool(() => getTask(client, args.id, capWaitSeconds(args.waitSeconds))),
  );

  server.registerTool(
    'list_my_generations',
    {
      description: "List recent 3D generations for this API key's user.",
    },
    async () => runTool(() => client.listGenerations()),
  );

  server.registerTool(
    'get_account',
    {
      description:
        'Show remaining credits and whether Pro / Ultra can be paid with non-trial credits.',
    },
    async () => runTool(() => client.getAccount()),
  );

  server.registerTool(
    'download_model',
    {
      description:
        'Download a completed generation to a local path. id is the task id from generate_model/get_task, not an upload assetId. format stl (default) converts the original GLB locally to binary STL with longest edge 100 mm (no color/texture). format glb writes the original file. Parent directory must already exist.',
      inputSchema: {
        id: z.string().describe('Task id from generate_model or get_task'),
        path: z.string().describe('Local destination path'),
        format: z.enum(['glb', 'stl']).optional().describe('Default stl'),
        longestEdgeMm: z
          .number()
          .optional()
          .describe('STL only; default 100; range 1–1000'),
      },
    },
    async (args) =>
      runTool(() =>
        downloadModel(client, {
          id: args.id,
          filePath: args.path,
          format: args.format ?? 'stl',
          longestEdgeMm: args.longestEdgeMm,
        }),
      ),
  );
}

async function runTool(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await work());
  } catch (error) {
    return errorResult(error);
  }
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data ?? null) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  if (error instanceof PictostlApiError) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: error.message,
            errorCode: error.errorCode,
            status: error.status,
          }),
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

async function uploadImage(
  client: PictostlClient,
  filePath?: string,
  url?: string,
) {
  const localPath = filePath?.trim();
  const imageUrl = url?.trim();
  if (!localPath && !imageUrl) {
    throw new Error('Provide a local path or HTTPS url');
  }
  if (localPath && imageUrl) {
    throw new Error('Provide a local path or HTTPS url, not both');
  }
  const file = localPath
    ? await readLocalImage(localPath)
    : await readRemoteImage(imageUrl!);
  const uploaded = await client.uploadImage(file.buffer, file.filename, file.mimeType);
  if (uploaded && typeof uploaded === 'object' && !Array.isArray(uploaded)) {
    const record = uploaded as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    return { ...record, assetId: id ?? record.assetId };
  }
  return uploaded;
}

async function readLocalImage(filePath: string) {
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error('Path is not a file');
  }
  const filename = path.basename(filePath);
  return {
    buffer: await readFile(filePath),
    filename,
    mimeType: mimeFromFilename(filename),
  };
}

async function readRemoteImage(imageUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('url must be an HTTPS URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('url must be an HTTPS URL');
  }
  const response = await fetch(parsed);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status})`);
  }
  const filename =
    path.basename(parsed.pathname) ||
    `image${extensionFromMime(response.headers.get('content-type'))}`;
  const mimeType =
    mimeFromHeader(response.headers.get('content-type')) || mimeFromFilename(filename);
  return {
    buffer: new Uint8Array(await response.arrayBuffer()),
    filename,
    mimeType,
  };
}

function mimeFromFilename(filename: string) {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? 'image/jpeg';
}

function mimeFromHeader(header: string | null) {
  if (!header) return undefined;
  const mime = header.split(';')[0]?.trim().toLowerCase();
  return mime || undefined;
}

function extensionFromMime(header: string | null) {
  const mime = mimeFromHeader(header);
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/jpeg') return '.jpg';
  return '.jpg';
}

async function getTask(client: PictostlClient, id: string, waitSeconds: number) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const data = await client.getGeneration(id);
    const status = readStatus(data);
    if (status && TERMINAL_STATUSES.has(status)) return data;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return data;
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }
}

function readStatus(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'status' in data) {
    const status = (data as { status?: unknown }).status;
    if (typeof status === 'string') return status;
  }
  return undefined;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function downloadModel(
  client: PictostlClient,
  input: {
    id: string;
    filePath: string;
    format: 'glb' | 'stl';
    longestEdgeMm?: number;
  },
) {
  const parent = path.dirname(input.filePath);
  try {
    const info = await stat(parent);
    if (!info.isDirectory()) {
      throw new Error('Parent path is not a directory');
    }
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new Error('Parent directory must already exist');
    }
    throw error;
  }

  const glb = await client.downloadGlb(input.id);
  if (input.format === 'glb') {
    const bytes = await writeGlbFile(input.filePath, glb);
    return {
      id: input.id,
      format: 'glb' as const,
      path: input.filePath,
      bytes,
    };
  }
  const written = await writeStlFile(input.filePath, glb, input.longestEdgeMm);
  return {
    id: input.id,
    format: 'stl' as const,
    path: input.filePath,
    bytes: written.bytes,
    longestEdgeMm: written.longestEdgeMm,
  };
}

function isErrno(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === code,
  );
}
