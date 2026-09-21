# pictostl-mcp

Local stdio MCP server for [pictostl.com](https://pictostl.com). Generation runs on pictostl.com — this package uploads photos, starts 3D jobs, and writes GLB or STL files on the machine that hosts the MCP server.

Results are AI-reconstructed meshes for visualization and 3D printing experiments. They are not engineering drawings.

This is a **local stdio** MCP server distributed from its GitHub repository. pictostl.com does not host a remote MCP HTTP endpoint.

## Architecture and data flow

```text
MCP client → local pictostl-mcp process → pictostl.com API
                                      ← generation status and GLB
MCP client ← local GLB/STL file       ←
```

The MCP process runs locally and communicates with `https://pictostl.com` over HTTPS. Images, generation parameters, and the API key are sent to pictostl.com to upload inputs, create jobs, and retrieve results. GLB-to-STL conversion and final file writing happen locally on the machine running the MCP server.

There is no hosted PicToSTL MCP endpoint. MCP clients start this package locally over `stdio`; the local process then calls the hosted PicToSTL API.

## Get an API key

1. [Sign up](https://pictostl.com)
2. Create a key at [API keys](https://pictostl.com/settings/api-keys)
3. Buy credits on [Pricing](https://pictostl.com/pricing)

By using the API or this MCP server you agree to the [Terms of Service](https://pictostl.com/terms-of-service).

Website browser generation is separate from MCP. MCP always uses an API key.

## Install from GitHub

Requires Node.js 20 or newer. The command below installs the repository through npm's Git support and builds the TypeScript server locally during installation. It does not require a published npm package.

## Claude / Cursor config

```json
{
  "mcpServers": {
    "pictostl": {
      "command": "npx",
      "args": [
        "-y",
        "--package=github:qduoduo-hwh/pictostl-mcp",
        "pictostl-mcp"
      ],
      "env": {
        "PICTOSTL_API_KEY": "ps_live_..."
      }
    }
  }
}
```

Set `PICTOSTL_API_KEY` to a live key from https://pictostl.com/settings/api-keys.

Optional: `PICTOSTL_API_BASE` (default `https://pictostl.com`) for a local website.

Keep the API key in your MCP client's secret or user-level configuration. Do not commit a live key to source control.

For a pinned installation, append a Git tag or commit after the repository name, for example `github:qduoduo-hwh/pictostl-mcp#v0.1.0`.

### Local development

```bash
git clone https://github.com/qduoduo-hwh/pictostl-mcp.git
cd pictostl-mcp
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Then configure the MCP client to run `node` with the absolute path to `dist/index.js` as its first argument.

## Tools

Seven MCP tools:

| Tool | Purpose |
| --- | --- |
| `list_generation_options` | Quality, texture, multi-view rules, and credit costs |
| `upload_image` | Upload a local file or HTTPS URL; returns `assetId` |
| `generate_model` | Start an async 3D job (sends `clientRequestId` even if you omit it) |
| `get_task` | Fetch a generation by **task id**; optional `waitSeconds` (max 60) |
| `list_my_generations` | List recent generations for this API key |
| `get_account` | Remaining credits and Pro / Ultra paid-credit status |
| `download_model` | Write original GLB, or a local binary STL, to a path |

Typical flow: `upload_image` → `generate_model` → `get_task` (repeat with the same task id if it takes more than 60 seconds) → `download_model` with that **task id**.

Do not pass an upload `assetId` to `get_task` or `download_model`.

`download_model` default is `format=stl`, longest edge **100 mm**, converted locally from the original GLB (not the website preview mesh). STL has geometry only — no color or textures. `format=glb` writes the original file unchanged.

Reuse `clientRequestId` from a previous `generate_model` result when retrying the same job.

## Contributing

Improve tool descriptions so agents call the right tool with the right fields. Do not ask for internal fal prompts or provider payloads.

## License

MIT
