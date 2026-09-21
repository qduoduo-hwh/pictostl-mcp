#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PictostlClient } from './client.js';
import { API_KEYS_URL } from './links.js';
import { registerTools } from './tools.js';
const apiKey = process.env.PICTOSTL_API_KEY;
if (!apiKey) {
    console.error(`PICTOSTL_API_KEY is required. Create a key at ${API_KEYS_URL}`);
    process.exit(1);
}
const client = new PictostlClient({
    apiKey,
    apiBase: process.env.PICTOSTL_API_BASE,
});
const server = new McpServer({ name: 'pictostl', version: '0.1.0' });
registerTools(server, client);
const transport = new StdioServerTransport();
await server.connect(transport);
