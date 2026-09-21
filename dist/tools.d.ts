import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type PictostlClient } from './client.js';
export declare const TOOL_NAMES: readonly ["list_generation_options", "upload_image", "generate_model", "get_task", "list_my_generations", "get_account", "download_model"];
export declare function capWaitSeconds(value: unknown): number;
export declare function resolveClientRequestId(value?: string): string;
export declare function registerTools(server: McpServer, client: PictostlClient): void;
