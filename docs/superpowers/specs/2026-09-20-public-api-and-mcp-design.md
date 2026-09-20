# pictostl 公开 REST API 与 MCP 接口契约

> 状态：已确认架构，待实现  
> 日期：2026-09-20  
> 修订：2026-09-20 上传改为预签名 PUT、任务 id 与上传 id 分命名空间、MCP 幂等、内部组装 `createModelService`  
> 产品：pictostl（https://pictostl.com）  
> 网站仓库：`E:\startup-os\products\image_2_3d`  
> MCP 仓库：`E:\startup-os\products\pictostl_mcp`（独立许可，MIT）  
> 本文是两边的接口与分工契约。两仓库各保留一份，内容必须一致。

已确认：

1. 网站提供 Bearer 鉴权的 REST `/api/v1`；MCP 是独立 **本地 stdio** 客户端（`npx -y pictostl-mcp`）。网站 v1 不托管 MCP 协议（无 `/mcp`、无 Streamable HTTP）。Cursor / Claude Code / Claude Desktop 用这种即可。
2. 网站只存储并下发 **GLB**。MCP 下载 GLB 后，在本地进程用 Three.js 转 **二进制 STL**（默认最长边 100 mm）。

参考实现：`design_home` 的 `/api/v1` 与 `design_home_mcp`。pictostl 的信封、积分、任务模型和 3D 导出与 room-redesign 不同，**不要照抄其 JSON 信封或 toolId**。

---

## 1. 目标

- 让 Claude、Cursor 等 MCP 宿主通过 pictostl 账号把图片生成 3D 模型，并把 GLB / STL 写到本地。
- 登录用户在网站创建 API Key；生成、扣费、退款、fal 调度、R2 存储仍只发生在网站。
- MCP 仓库可独立开源、独立发版，不含 ShipAny / 网站源码、不含 `FAL_KEY`、不含积分公式实现。

## 2. 非目标（v1）

- 网站不提供 `/mcp`、不返回 STL、不在服务端做网格缩放。
- 不把现有 Cookie 接口 `/api/model3d/*` 改成公开 API。
- MCP 不实现登录、支付、Key 管理、积分计算、fal 调用。
- 不开放 OBJ / PLY、检测修复、灵感库、OAuth-for-API、Key 权限范围、IP 白名单、公开 OpenAPI 门户。
- 不把游客未登录试用接到 API / MCP（网站本身也要求生成前登录）。
- 不对 Agent 暴露预签名 URL 或 R2 细节。不提供经 Next 函数体的 multipart 上传（Vercel 请求体约 4.5 MB，现网单图上限 10 MB）。

---

## 3. 仓库分工

```text
Agent (Claude / Cursor / 其他 MCP host)
  → 本地 stdio MCP（npx -y pictostl-mcp）
    → HTTPS JSON + Authorization: Bearer ps_live_...
      → https://pictostl.com/api/v1/*
        → 现有 model3d / credits / R2 / fal worker
```

`upload_image` 对 Agent 仍是一步；MCP 进程内部走「intent → PUT 存储 → complete」。PUT 的目标是 R2（或本地一次性 URL），**不带** Bearer。

| 单元 | 仓库 | 职责 |
| --- | --- | --- |
| 公开 REST | `image_2_3d` | API Key、`/api/v1`、上传 intent/complete、生成、积分、GLB/封面授权下载 |
| 网站 Web | `image_2_3d` | 现有页面与 `/api/model3d/*` Cookie 流程，v1 保持行为不变 |
| 开源 MCP | `pictostl_mcp` | MCP 协议、工具描述、HTTP 客户端、内部预签名 PUT、轮询、本地 STL、npm 发包、README |

两边独立版本。Agent 看到的工具名和参数改 MCP 仓库；模型、计费、fal、存储改网站。

### 3.1 `image_2_3d` 必须做

- `apikey` 表：只存 SHA-256，不存明文。
- `/settings/api-keys`：登录用户创建 / 列表 / 撤销；明文只在创建响应里出现一次。
- `/api/v1/*`：只认 `Authorization: Bearer`，忽略 Cookie。不要走 `modelActor`（Cookie 路由有 Origin 校验）。
- 公开上传：预签名 PUT，不经 Vercel 函数体传 10 MB 图。
- 公开生成：把已就绪的 API 图片组装进现有 `model_upload` / `model_task`，再调用 `createModelService` 的预占、结算、失败释放；不重写 worker。
- `model_task` 增加 `source`（`web` / `api`）和 `client_request_id`（API 任务必填）。
- 公开 DTO：单独映射，不复用现网 `publicTask()`（它带 `kind`、Title Case 状态、未完成也有 `modelUrl`）。
- `GET /api/v1/assets/{taskId}?format=glb|png`：`{taskId}` **只认任务 id**，与现网 `/api/model3d/assets/{task.id}` 同一命名空间。
- 设置页与 `/api/v1` 不进 sitemap；`/settings` 已在 robots 禁止前缀内。
- v1 错误响应必须带英文 `message`。`INVALID_API_KEY` / `RATE_LIMITED` 等 API 专用码走独立助手，不直接复用只返回 `{ code }` 的 `toErrorResponse`。

### 3.2 `image_2_3d` 禁止做

- 禁止 `/api/v1/assets/{id}?format=stl` 或任何服务端 STL。
- 禁止把 MCP SDK 或 JSON-RPC 接到 Next 路由。
- 禁止 Cookie session 调用 `/api/v1`。
- 禁止 API Key 创建/列表/撤销走 `/api/v1`（必须走网站登录 session）。
- 禁止公开 API 用 multipart 把整图打进 Next 函数（会撞 Vercel 约 4.5 MB 上限）。
- 禁止把网站或 ShipAny 代码提交进 `pictostl_mcp`。
- 禁止在 `main` 上直接改代码；网站改动走 worktree。

### 3.3 `pictostl_mcp` 必须做

- stdio MCP，官方 SDK，npm 名 `pictostl-mcp`；`package.json` 含 `bin`、`files: ["dist", "README.md", "LICENSE"]`、`type: module`、`engines.node >= 20`、`publishConfig.access: public`。入口 `dist/index.js`（tsc）。未发布到 npm 时 `npx -y pictostl-mcp` 不可用。
- 环境变量：`PICTOSTL_API_KEY`（必填）、`PICTOSTL_API_BASE`（可选，默认 `https://pictostl.com`）。
- 实现下表工具。`upload_image` 读本地文件或 HTTPS URL，内部完成 intent → PUT → complete；工具参数里没有 `uploadUrl`。
- `generate_model`：Agent 若未传 `clientRequestId`，MCP **必须自己生成 UUID 并发送**；成功结果里原样返回，便于重试。
- `get_task` 的 `waitSeconds` 上限 60，轮询到 `completed` / `failed` 或超时。超时返回最后一次 DTO，不算工具错误。工具 description 必须写明：生成常超过 60 秒，应用同一 `id` 再调。
- `download_model`：`id` 是 **任务 id**。带 Bearer 拉 `GET /assets/{taskId}?format=glb`；跟随 307 时去掉 Bearer（`redirect: 'manual'` 或换 host 后剥离 `Authorization`）。`format=glb` 原样落盘；`format=stl` 本地转二进制 STL 再落盘。
- 错误把 `error.code` 和 `error.message` 传给 Agent；`INVALID_API_KEY` 补 Key 页链接，`INSUFFICIENT_CREDITS` 补价格页链接。

### 3.4 `pictostl_mcp` 禁止做

- 禁止调用 `/api/model3d/*`、禁止带 Cookie、禁止实现 fal / R2 / 积分账本。
- 禁止把预签名 URL 或存储细节放进工具 schema / 结果给 Agent。允许 MCP 进程对 `uploadUrl` 做 PUT（不带 Bearer）。
- 禁止把 GLB 再上传回网站做转换。
- 禁止在工具结果里编造百分比进度、可打印保证、工程图纸口径。
- 禁止依赖网站 UI 或 Three.js 浏览器 viewer；STL 在 Node 进程内完成。

### 3.5 接口归属（一览）

| 能力 | 网站 `/api/v1` | MCP 工具 |
| --- | --- | --- |
| 档位 / 纹理 / 积分表 | `GET /options` | `list_generation_options` |
| 上传一张图 | `POST /uploads/intents` + PUT `uploadUrl` + `POST /uploads/{id}/complete` | `upload_image`（对 Agent 隐藏三步） |
| 创建生成任务 | `POST /generations` | `generate_model` |
| 查询任务 | `GET /generations/{id}` | `get_task` |
| 历史 | `GET /generations` | `list_my_generations` |
| 账户积分 | `GET /account` | `get_account` |
| 读封面 / 原 GLB | `GET /assets/{taskId}` | `download_model`（`id` = 任务 id） |
| 二进制 STL | **不提供** | `download_model` 本地转换 |
| 创建 API Key | 网站 session `/settings/api-keys` | 无 |

id 命名空间（必须分开）：

| id | 谁发 | 用在哪 |
| --- | --- | --- |
| 上传图片 id | `complete` 返回的 `id` | 仅 `imageAssetIds[]`。**不能**拿去 `GET /assets` 或 `download_model` |
| 任务 id | `POST /generations` 返回的 `id` | `get_task`、`download_model`、`GET /assets/{taskId}`、任务 DTO 的 `coverUrl` / `modelUrl` |

---

## 4. 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 传输 | 网站 REST + 本地 stdio MCP | 与 room-redesign 一致；网站可闭源，MCP 可 `npx`；Cursor / Claude Code 用 stdio |
| 信封 | pictostl 现有 `{ ok, data }` / `{ ok: false, error }` | 不引入 design_home 的 `{ code: 0 }` |
| 上传 | 预签名 PUT；MCP 对 Agent 隐藏三步 | Vercel 函数体约 4.5 MB；现网单图 10 MB 已是直传 R2 |
| 生成 | 组装进现有 `model_upload` + `model_task` + worker | 积分预占、失败释放、30 天清理保持一套 |
| 模型文件 | 网站只存 GLB | 与当前 R2 对象一致 |
| STL | MCP 用 Three.js 转 **原 GLB**；默认最长边 100 mm | 尺寸对齐网页默认；网格来自原文件不是 preview；不增加网站 CPU |
| 状态 | 对外四态 `queued` / `generating` / `completed` / `failed` | 内部 worker 状态不暴露 |
| 试用积分 | Pro/Ultra 走现有 `excludeSignup` | 不足则 `INSUFFICIENT_CREDITS`，不另造付费墙码 |
| 幂等 | MCP 必发 `clientRequestId`；网站按用户 + 该 id + 指纹去重 | Agent 重试常见；缺 id 会重复扣费 |
| Key 前缀 | `ps_live_` | 与 `rr_live_` 区分产品 |

---

## 5. 网站 REST `/api/v1`

Base URL：`https://pictostl.com/api/v1`  
本地：`PICTOSTL_API_BASE` + `/api/v1`。

除 **PUT `uploadUrl`** 外，所有 `/api/v1/*` 要求：

```http
Authorization: Bearer ps_live_<secret>
```

缺少、格式错误、未知、已撤销、用户不存在 → `INVALID_API_KEY`（401）。Cookie 一律忽略。

PUT `uploadUrl`：**禁止**带 Bearer（生产是 R2 主机；本地是带一次性 token 的本站 URL）。

### 5.1 信封

成功：

```json
{ "ok": true, "data": {} }
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Not enough credits for this generation."
  }
}
```

相对现有 Cookie API 的差异：`/api/v1` 的 `error` **必须带** 英文 `message`，便于 Agent。Cookie 路由可继续只返回 `{ ok: false, error: { code } }`。

5xx 只返回通用 message 与可选 `error.id`，禁止堆栈、fal 响应、存储签名 URL。

### 5.2 端点

| 方法 | 路径 | 鉴权限流桶 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/account` | other | 积分与档位能力 |
| `GET` | `/options` | other | 档位、纹理、多视图规则、积分表 |
| `POST` | `/uploads/intents` | other | 登记一张图，返回预签名 PUT |
| `PUT` | `uploadUrl`（R2 或本地一次性 URL） | 无（token） | 原始字节；不带 Bearer |
| `POST` | `/uploads/{id}/complete` | other | 校验并返回 `imageAssetIds` 用的 id |
| `POST` | `/generations` | generate | 创建异步任务 |
| `GET` | `/generations/{id}` | other | 任务 DTO |
| `GET` | `/generations` | other | 当前用户最近最多 100 条 |
| `GET` | `/assets/{taskId}` | other | `format=png`（默认）或 `format=glb`；**仅任务 id** |

限流：

- `POST /generations`：每用户每分钟 10 次（只数 `model_task.source = 'api'`）。
- 其余需 Bearer 的 `/api/v1`：每把 Key 每分钟 60 次（记在 `apikey` 行上）。
- 超限：`RATE_LIMITED`（429），`Retry-After` 秒。

无 Redis。生成限流查任务表；其他限流用 Key 行窗口计数（更新须原子，避免并发窗口击穿）。

### 5.3 `GET /account`

```json
{
  "emailVerified": true,
  "remainingCredits": 22,
  "remainingPaidCredits": 20,
  "reservedCredits": 0,
  "canUsePro": true,
  "canUseUltra": false
}
```

| 字段 | 含义 |
| --- | --- |
| `remainingCredits` | 未过期可用积分，含试用 |
| `remainingPaidCredits` | 同上但排除 `sourceType = signup`（现网 `getCreditBalance` 无此字段，v1 要新查） |
| `reservedCredits` | 生成预占中的积分 |
| `canUsePro` | `remainingPaidCredits >= 20` |
| `canUseUltra` | `remainingPaidCredits >= 40` |

`canUsePro` / `canUseUltra` 只是能力提示：20 分仍不够 Pro+Standard（30）。Agent 以 `/options.costs` 为准。

试用 2 分只能 Basic。Pro/Ultra 不看「有没有买过套餐」，只看非 signup 余额是否够本次费用（创建任务时 `excludeSignup: quality !== 'Basic'`）。

### 5.4 `GET /options`

Agent 先调这个，不要写死积分。

```json
{
  "modes": ["single", "multi"],
  "qualities": ["Basic", "Pro", "Ultra"],
  "textures": ["None", "Standard", "HD"],
  "views": ["Front", "Left", "Back", "Right"],
  "maxImages": { "single": 1, "multi": 4 },
  "minImages": { "single": 1, "multi": 2 },
  "maxBytesPerImage": 10485760,
  "acceptedTypes": ["image/jpeg", "image/png", "image/webp"],
  "costs": [
    { "quality": "Basic", "texture": "None", "credits": 2 },
    { "quality": "Pro", "texture": "None", "credits": 20 },
    { "quality": "Pro", "texture": "Standard", "credits": 30 },
    { "quality": "Ultra", "texture": "None", "credits": 40 },
    { "quality": "Ultra", "texture": "Standard", "credits": 50 },
    { "quality": "Ultra", "texture": "HD", "credits": 60 }
  ],
  "rules": [
    "Basic only allows texture None.",
    "Pro does not allow texture HD.",
    "single requires exactly 1 image; multi requires 2–4 images of the same object.",
    "Pro/Ultra multi-view requires unique labels from Front/Left/Back/Right and must include Front.",
    "Basic multi-view does not require view labels.",
    "Signup credits cannot pay for Pro or Ultra.",
    "Failed generations release the credit hold. Repeat download does not charge again.",
    "Successful models are kept 30 days. The API returns GLB only; STL is produced by the MCP client."
  ]
}
```

积分表与 `src/modules/model3d/service.ts`、`generation-config.ts` 必须一致（费用应有单一数据源，禁止三处手抄漂移）。改费用只改网站，MCP 只展示本接口。

`validateRasterImage` 的通用上限是 50 MB；公开上传必须 **另外卡 10 MB**。

### 5.5 上传（intent → PUT → complete）

一次一张。多视图由 MCP 连调 2–4 次。JPEG / PNG / WebP，最大 **10 MB**。

公开 API **没有** `POST /uploads` multipart。Cookie 站的 `/api/model3d/uploads` 两步 PUT 保持不变，不暴露给 Agent。

#### `POST /uploads/intents`

```json
{
  "filename": "front.png",
  "mimeType": "image/png",
  "sizeBytes": 204800
}
```

| 字段 | 规则 |
| --- | --- |
| `filename` | 1–255 字符 |
| `mimeType` | `image/jpeg` / `image/png` / `image/webp` |
| `sizeBytes` | 正整数，1–10485760 |

HTTP 201：

```json
{
  "id": "asset_uuid",
  "uploadUrl": "https://…",
  "headers": { "Content-Type": "image/png" },
  "maxBytes": 10485760
}
```

- 生产：`uploadUrl` 为 R2 预签名 PUT，TTL 约 300 秒（与现网 `presignPut` 一致）。
- 本地存储：`uploadUrl` 为本站一次性 PUT（路径或 query 带 token），用 token 鉴权，不要求 Bearer。
- 行状态 `pending`，24 小时未 complete 则过期。

#### PUT `uploadUrl`

- 请求体为原始文件字节；`Content-Type` 用 intent 返回的 `headers`。
- 不带 `Authorization`。
- 超过 `sizeBytes` / `maxBytes` → 存储侧拒绝或 complete 时失败。

#### `POST /uploads/{id}/complete`

Bearer 必填。`{id}` 是 intent 返回的上传图片 id。

- 对象必须存在且字节数与 intent 一致，否则 `ASSET_NOT_READY`（409）。
- 魔数 + sharp 可解码（复用 `validateRasterImage`，再卡 10 MB）。失败：`INVALID_IMAGE` / `UNSUPPORTED_MEDIA` / `OBJECT_TOO_LARGE`。
- 非本人或未知 id → `ASSET_NOT_FOUND`（404），不暴露是否存在。
- 已 complete 且同一对象 → 幂等返回原 DTO。
- 所有权 = Key 的 `userId`。

成功：

```json
{
  "id": "asset_uuid",
  "filename": "front.png",
  "mimeType": "image/png",
  "sizeBytes": 204800,
  "width": 1024,
  "height": 768
}
```

`id` 即后续的 `imageAssetIds[]`。未进入生成的上传 24 小时过期。

存储：新表（如 `public_api_image`）或复用 `private_asset`（仅登录用户、`purpose=reference`、无 guest）。对象 key 与现网 `models/{taskId}/input-*` 分开，例如 `api-uploads/{id}`。

### 5.6 `POST /generations`

```json
{
  "imageAssetIds": ["asset_1"],
  "mode": "single",
  "quality": "Basic",
  "texture": "None",
  "views": ["Front", "Left"],
  "clientRequestId": "uuid"
}
```

| 字段 | 规则 |
| --- | --- |
| `imageAssetIds` | 均属于当前用户、已 complete、未过期、未删除 |
| `mode` | `single`：恰好 1 张；`multi`：2–4 张 |
| `quality` / `texture` | 与 `generationConfig` 相同：Basic 仅 None；Pro 禁止 HD |
| `views` | Pro/Ultra + multi：**必填**，与图片数量相同、无重复、∈ {Front,Left,Back,Right}、必须含 Front。Basic multi **忽略**（可省略） |
| `clientRequestId` | UUID。REST 客户端省略时网站生成一个新 UUID（无幂等）。MCP **必须发送**（见 7.2） |

指纹：`options`（mode / quality / texture / views）+ 有序 `imageAssetIds`。

幂等：

- 同一用户 + 同一 `clientRequestId` + 同一指纹 → 返回已有任务，不二次扣费（HTTP 200 或 201 均可，body 为原任务 DTO）。
- 同一用户 + 同一 `clientRequestId` + 不同指纹 → `CLIENT_REQUEST_CONFLICT`（409）。
- 不同 `clientRequestId`（含网站新生成的）→ 新任务。

校验顺序：鉴权 → 限流 → 参数/档位 → 资源所有权 → 幂等查找 → 积分预占 → 写 `model_task`。非法档位在扣费前失败。

HTTP 201（新建）或 200（幂等命中），body 为任务 DTO（见 5.8）。任务异步；worker 与现网 `/api/internal/model3d/run` 相同。页面关闭不等于取消。

费用（用户积分 / 次，单图多图同价）：

| quality | texture | credits |
| --- | --- | --- |
| Basic | None | 2 |
| Pro | None | 20 |
| Pro | Standard | 30 |
| Ultra | None | 40 |
| Ultra | Standard | 50 |
| Ultra | HD | 60 |

成功才结算；明确失败释放预占。转存失败只重试转存，不重新生成。

#### 5.6.1 内部如何接 `createModelService`

现网 `prepare(requestId, options, files)` 把 **options + 文件元数据** 绑在一起，且 **task id = upload id = requestId**。公开 API 是先上传图、后选档位，不能把 Cookie 的预签名 prepare 暴露出去，也不能假设调用方已把文件放到 `models/{requestId}/input-*`。

公开 `POST /generations` 内部步骤：

1. 解析并校验 body；`clientRequestId` 缺则生成 UUID。
2. 按 `(userId, clientRequestId)` 查已有 `model_task`（`source = 'api'`）。命中则按指纹决定返回或 409。
3. 读取各 `imageAssetIds` 对应已就绪对象。
4. 选定 **新的** `model_upload.id` / `model_task.id`（现网等式仍成立）。推荐用 `clientRequestId` 作为该 id，这样现网 `prepare` 的 requestId 冲突语义可复用。
5. 把 API 对象 **拷贝**（或等价 durable 引用）到 `models/{taskId}/input-*`。拷贝后任务生命周期跟现网（成功后 30 天）；未引用的 API 上传仍 24 小时过期。
6. 组装 `files[]`（name / type / size / key）和 `options`，调用现有校验 + `reserveCredits` + `insert model_task`（与 `create()` 相同预占/结算）。不要重写 worker。
7. 写入 `source = 'api'`、`client_request_id`。网站 Cookie 任务 `source = 'web'`，`client_request_id` 为空。
8. 返回 **v1 任务 DTO**，不要把 `publicTask()` 原样输出。

现网 `prepare` 还有每用户最多 20 个未完成上传的限制；公开 API 的 pending intent 单独计数，避免和浏览器草稿抢配额。具体上限可与 20 对齐，但表要分开。

### 5.7 `GET /generations` 与 `GET /generations/{id}`

列表：当前用户、未删除、最近 100 条，新的在前（含该用户网站任务与 API 任务，与「用这把 Key 的用户」一致，不按 Key 再过滤）。  
单条：必须是该用户的任务；别人的 id 返回 `TASK_NOT_FOUND`（404），不暴露是否存在。`{id}` 是任务 id。

### 5.8 任务 DTO

```json
{
  "id": "task_uuid",
  "clientRequestId": "uuid",
  "name": "front.png",
  "mode": "single",
  "quality": "Basic",
  "texture": "None",
  "views": null,
  "cost": 2,
  "status": "generating",
  "createdAt": "2026-09-20T12:00:00.000Z",
  "expiresAt": null,
  "error": null,
  "coverUrl": "https://pictostl.com/api/v1/assets/{taskId}?format=png",
  "modelUrl": null
}
```

`coverUrl` / `modelUrl` 中的 `{taskId}` 等于本对象的 `id`（任务 id），**不是** `imageAssetIds`。

`status` 只允许：

| 对外 | 对内（不返回） |
| --- | --- |
| `queued` | `queued`, `preparing`, `pending` |
| `generating` | `submitting`, `unknown`, `generating`, `transferring` |
| `completed` | `completed` |
| `failed` | `failed` |

`completed` 时 `modelUrl` 为 `https://pictostl.com/api/v1/assets/{taskId}?format=glb`，`expiresAt` 为成功时刻 + 30 天。未完成时 `modelUrl` 为 `null`。`coverUrl` 在创建后即可用（原图或封面）。

禁止字段：`providerRequestId`、`statusUrl`、`responseUrl`、`leaseToken`、`reservationId`、`model_url`（供应商 URL）、`kind`、`prompt`。

`EMAIL_VERIFICATION_REQUIRED`：现网验证后才发 signup 2 分，生成路径目前不查 `emailVerified`。此码预留；不要写成当前就会返回。

### 5.9 `GET /assets/{taskId}`

`{taskId}` **只认任务 id**。传入上传图片 id → 按任务查找失败 → `ASSET_NOT_FOUND` / `TASK_NOT_FOUND`（对外 404，不暴露类型）。

Query：`format=png`（默认）或 `format=glb`。其他值（含 `stl`）→ `INVALID_REQUEST`（400）。

- 所有者 + 未删除 + 未过期，否则 `ASSET_NOT_FOUND` / `ASSET_EXPIRED`。
- `glb` 且任务未 `completed` → `ASSET_NOT_READY`（409）。
- 生产 R2：307 到短 TTL 预签名 GET（约 60 秒）。MCP 跟随重定向时 **不要** 把 Bearer 带到 R2。
- 本地存储：可直接返回 bytes。
- `png`：有封面用封面，否则第一张输入图。
- GLB 上限 150 MB（与现网 `storage.read` 一致）。实现复用 `createModelService().asset(userId, taskId, format)`，鉴权改为 API Key 用户。

---

## 6. API Key 与设置页（仅网站）

### 6.1 谁能创建

已登录注册用户，含未付费用户。游客不能。创建 Key 不要求已验证邮箱。花费 **signup** 积分时，若产品规则要求已验证邮箱，则生成返回 `EMAIL_VERIFICATION_REQUIRED`（403）。当前赠送发生在验证之后，此码仍要预留。

### 6.2 UI

- 路由：`/settings/api-keys`（英文、需登录、noindex）。
- 导航必须出现在三处，否则用户从工作室找不到：
  1. `product-routes.ts`
  2. `commerce-shell`（Billing / Credits 旁）
  3. **工作室头像菜单**（`product-header`，现仅有 My subscription / Sign out）
- 可命名、创建、看元数据、撤销。每用户最多 5 把 **active** Key。
- 明文只在创建时显示一次；之后 `ps_live_…abcd`（前缀 + 后四位）、创建时间、最后使用、状态。
- 页内链到 `/pricing`，并说明 Key 用于 MCP / API，不是网站登录。

Key CRUD 是网站 session 的 server action / 内部路由，**不是** `/api/v1`。偷到的公开 Key 不能列出或再造 Key。

### 6.3 表 `apikey`

新迁移（当前最新为 `0015_*`，本功能为下一号）。同一迁移内加 `model_task.source`、`model_task.client_request_id`，以及 API 上传表（若未复用 `private_asset`）。

| 列 | 用途 |
| --- | --- |
| `id` | PK |
| `user_id` | 所有者，FK `user.id` ON DELETE CASCADE |
| `name` | 用户标签，最长 80 |
| `key_hash` | 明文 SHA-256 hex，UNIQUE |
| `key_prefix` | `ps_live_` |
| `last_four` | 展示用 |
| `status` | `active` / `revoked` |
| `created_at` / `updated_at` / `last_used_at` | |
| `rate_window_started_at` / `rate_window_count` | 非生成接口的 60 秒窗口 |

明文：`ps_live_` + 32 字节 `base64url`。查找：hash Bearer，匹配 `status = active`。v1 无 scope，一把 active Key 可调全部允许的 `/api/v1`。

`model_task` 增补：

| 列 | 用途 |
| --- | --- |
| `source` | `web`（默认，Cookie 站）/ `api`（公开 API）。生成限流只数 `api` |
| `client_request_id` | API 任务必填 UUID；网站任务为空。UNIQUE (`user_id`, `client_request_id`) 在 `client_request_id IS NOT NULL` 时成立 |

### 6.4 `/api/v1` 鉴权管线

1. 要有 `Authorization: Bearer …`，否则 `INVALID_API_KEY`。
2. Hash 查 active Key；没有或已撤销 → `INVALID_API_KEY`。
3. 加载用户；禁用或不存在 → `INVALID_API_KEY`。
4. 尽力更新 `last_used_at`。
5. 限流。
6. 与网站生成相同的积分/资源检查，但无游客分支。

PUT `uploadUrl` 不走本管线。

---

## 7. MCP 工具契约（`pictostl_mcp`）

包名：`pictostl-mcp`  
运行时：Node.js ≥ 20，TypeScript，`@modelcontextprotocol/sdk`，stdio。  
配置：

```json
{
  "mcpServers": {
    "pictostl": {
      "command": "npx",
      "args": ["-y", "pictostl-mcp"],
      "env": {
        "PICTOSTL_API_KEY": "ps_live_..."
      }
    }
  }
}
```

缺 `PICTOSTL_API_KEY` 时进程退出码 1，并打印 `https://pictostl.com/settings/api-keys`。

`npx -y pictostl-mcp` 依赖把包发布到 npm（公开 scope）。独立 GitHub 仓库；照 `design_home_mcp` 的 `bin` / `prepublishOnly`（test + build）。

### 7.1 工具列表（恰好 7 个）

| 工具 | HTTP | 说明 |
| --- | --- | --- |
| `list_generation_options` | `GET /options` | 档位与积分 |
| `upload_image` | intent + PUT + complete | 本地路径或 HTTPS URL → `assetId` |
| `generate_model` | `POST /generations` | 开异步任务；必带 `clientRequestId` |
| `get_task` | `GET /generations/{id}` | 可选轮询；超时再调 |
| `list_my_generations` | `GET /generations` | 最近任务 |
| `get_account` | `GET /account` | 积分 |
| `download_model` | `GET /assets/{taskId}?format=glb` | `id` = 任务 id；落盘 GLB 或本地转 STL |

没有 `search_inspiration`，没有 `compile_*`。

### 7.2 各工具输入

**`list_generation_options`**  
无参数。

**`upload_image`**

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `path` | string，可选 | 本地文件 |
| `url` | string，可选 | 仅 `https:` |

必须且只能提供一个。MCP 内部：读字节 → `POST /uploads/intents` → **不带 Bearer** PUT `uploadUrl` → `POST /uploads/{id}/complete`。成功 JSON 在网站 `id` 之外再带 `assetId`（同值），方便 Agent 下一步。不要把 `uploadUrl` 返回给 Agent。

**`generate_model`**

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `imageAssetIds` | string[]，min 1 | 是 |
| `mode` | `single` \| `multi` | 是 |
| `quality` | `Basic` \| `Pro` \| `Ultra` | 是 |
| `texture` | `None` \| `Standard` \| `HD` | 是 |
| `views` | `Front` \| `Left` \| `Back` \| `Right` 的数组 | Pro/Ultra + multi 时是 |
| `clientRequestId` | uuid string | 对 Agent 可选；**MCP 缺则生成并 POST** |

成功结果必须包含网站返回的 `id` 与 `clientRequestId`。工具 description 写明：重试同一生成时传入上次的 `clientRequestId`。

**`get_task`**

| 字段 | 类型 |
| --- | --- |
| `id` | string，必填，**任务 id** |
| `waitSeconds` | number，可选，钳制到 `[0, 60]` |

轮询间隔 2s，直到 `completed` / `failed` 或超时（超时仍返回最后一次 DTO，不算工具错误）。description 必须写：一次最多等 60 秒；Pro/Ultra 常更久，超时后用同一 `id` 再调用直到终态。

**`list_my_generations`** / **`get_account`**  
无参数。

**`download_model`**

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | string | **任务 id**（`generate_model` / `get_task` 的 `id`），不是 `assetId` |
| `path` | string | 本地目标路径；父目录必须已存在 |
| `format` | `glb` \| `stl` | 默认 `stl` |
| `longestEdgeMm` | number | 仅 STL；默认 100；范围 1–1000 |

跟随 307：换 host 后不得转发 Bearer。

成功返回：

```json
{
  "id": "task_uuid",
  "format": "stl",
  "path": "C:\\models\\cat-100mm.stl",
  "bytes": 1234567,
  "longestEdgeMm": 100
}
```

`format=glb` 时不出现 `longestEdgeMm`（或为 null）。原 GLB 字节不做缩放。

Ultra 原 GLB 可到约 50–60 MB；Node 内 parse 失败或内存不足是工具错误，不标记网站任务失败，不退积分。

### 7.3 MCP 错误

网站 `{ ok: false, error: { code, message } }` 转为工具 `isError: true` 文本 JSON：

```json
{
  "message": "Not enough credits for this generation. https://pictostl.com/pricing",
  "errorCode": "INSUFFICIENT_CREDITS",
  "status": 409
}
```

MCP 客户端在这些 code 上追加官方 URL（若 message 里还没有）：

- `INVALID_API_KEY` → `https://pictostl.com/settings/api-keys`
- `INSUFFICIENT_CREDITS` → `https://pictostl.com/pricing`

### 7.4 布局

```text
pictostl_mcp/
  README.md
  LICENSE
  package.json      # name, bin, files, engines, publishConfig
  tsconfig.json
  src/index.ts      # stdio 入口
  src/client.ts     # /api/v1 HTTP；307 时剥离 Bearer
  src/tools.ts      # 七个工具；upload 三步；generate 补 clientRequestId
  src/stl.ts        # 原 GLB → 二进制 STL
  src/links.ts      # 官网 URL
  dist/             # tsc 输出；bin → dist/index.js
  test/
```

无 fal key、无积分公式、无网站 UI。

README 必须写：生成跑在 [pictostl.com](https://pictostl.com)；注册、API Key、价格、ToS；输出是 AI 网格不是工程图纸；网站游客/浏览器流程与 MCP 分开；STL 在本地按最长边毫米缩放（原 GLB，非网页 preview）；GLB 为原始文件；本包是本地 stdio，不是 pictostl.com 上的远程 `/mcp`。

---

## 8. MCP 本地 STL（算法契约）

默认最长边 **100 mm**，与网页「Download STL」的默认尺寸对齐。网格与原点不保证和网页按钮逐字节一致。

网站 viewer：加载的是 **preview GLB**，缩放到最长边 100 后 **居中**，再 `exportGeometry(..., size, 'stl')`。网页 STL 因此来自简化网格。

MCP（`format=stl`）转的是 **原 GLB**（`GET /assets/{taskId}?format=glb`），不做居中：

1. 拉原 GLB（跟 307，不把 Bearer 带到 R2）。
2. Three.js `GLTFLoader.parse`（含 meshopt 则挂 `MeshoptDecoder`）。不调用 `WebGLRenderer`，不依赖 DOM / jsdom。
3. 算世界包围盒最长边 `L`。`L` 非有限或不大于 0 则失败。
4. 根节点均匀缩放 `longestEdgeMm / L`，`updateMatrixWorld(true)`。
5. `STLExporter.parse(root, { binary: true })`，写成 `path`。
6. 不改材质、不做居中。原点保持原 GLB 缩放后的原点（网页 STL 是居中的）。

约束：

- `longestEdgeMm` 默认 100，整数或有限数，范围 1–1000。
- STL 无颜色/纹理。工具 description 必须写明。
- `format=glb`：把响应 body 原样写入 `path`，不经 Three.js。
- 转换只在 MCP 进程；失败是工具错误，不标记网站任务失败，不退积分。

依赖：`three`（及 STLExporter / GLTFLoader）。不要为了转 STL 引入 Python 或网站包。

---

## 9. 错误码

`/api/v1` 使用这些 `error.code`。HTTP 与现网 `DomainError` 对齐，并补 API 专用码。

| code | HTTP | 何时 |
| --- | --- | --- |
| `INVALID_API_KEY` | 401 | 缺 Key、坏 Key、已撤销、用户无效 |
| `EMAIL_VERIFICATION_REQUIRED` | 403 | 预留：未验证邮箱却要花 signup 积分 |
| `INSUFFICIENT_CREDITS` | 409 | 余额不足；Pro/Ultra 排除试用后仍不足 |
| `INVALID_REQUEST` | 400 | 参数、档位组合、`format=stl` 等非法 |
| `INVALID_IMAGE` | 400 | 非 JPEG/PNG/WebP 或无法解码 |
| `UNSUPPORTED_MEDIA` | 415 | 类型不允许 |
| `OBJECT_TOO_LARGE` | 413 | 单图 > 10 MB |
| `ASSET_NOT_FOUND` | 404 | 上传或任务资源不存在 / 非本人（对外不暴露） |
| `ASSET_EXPIRED` | 410 | 过期 |
| `ASSET_NOT_READY` | 409 | GLB 尚未完成，或 intent 后文件未到位 |
| `CLIENT_REQUEST_CONFLICT` | 409 | 同一 `clientRequestId` 不同指纹 |
| `TASK_NOT_FOUND` | 404 | 未知或不属于当前用户的任务 |
| `RATE_LIMITED` | 429 | 超限 |
| `INTERNAL_ERROR` | 500 | 未预期；无内部细节 |

MCP 不自造另一套 code，只原样传递并补链接。

---

## 10. 调用时序

```text
Agent
  1. get_account
  2. list_generation_options          → 选 Basic/None/single
  3. upload_image { path }            → assetId
     （MCP 内部：intents → PUT 无 Bearer → complete）
     （multi：重复 2–4 次）
  4. generate_model { imageAssetIds, mode, quality, texture, views?,
                      clientRequestId }   ← MCP 缺则自生成
                                      → task.id, clientRequestId, status=queued|generating
  5. get_task { id: task.id, waitSeconds: 60 }
                                      → 未终态则同一 id 再调，直到 completed|failed
  6. download_model { id: task.id, path, format: "stl", longestEdgeMm: 100 }
                                      → 本地 .stl
```

失败：`get_task` 返回 `status=failed` 与 `error`；积分应已释放。Agent 不应对同一失败任务再 `download_model`。

幂等：相同用户 + 相同 `clientRequestId` + 相同指纹 → 返回原任务，不新扣费。不要把 `upload_image` 的 `assetId` 传给 `download_model`。

---

## 11. 测试边界

### 网站 `image_2_3d`

- 创建 Key 只存 hash；完整密钥只出现在创建响应。
- 无 Key / 坏 Key / 已撤销 / 纯 Cookie → 401 `INVALID_API_KEY`。
- 跨用户读任务或资产 → 404。
- `GET /assets/{taskId}?format=stl` → 400。
- `GET /assets/{uploadImageId}?format=glb` → 404（上传 id 不是任务 id）。
- 任务 DTO 无供应商字段、无 `prompt`、无 `kind`；未完成时 `modelUrl` 为 null。
- Basic + 试用积分成功预占 2；Pro + 仅试用积分 → `INSUFFICIENT_CREDITS`，不写成功任务。
- 非法档位（Basic+HD）在扣费前 400。
- Pro/Ultra multi 缺 Front → 400。
- 失败生成释放预占（复用 model3d 测试，补一条 v1 路径）。
- 同一 `clientRequestId` 重放返回同一任务 `id`；同 id 不同指纹 → 409。
- 上传走 intent + PUT + complete；大于约 4.5 MB 且 ≤ 10 MB 的图在生产路径下仍成功（测本地 PUT 或 mock 存储，不把整图 POST 进函数体）。
- `source = 'api'` 的任务计入生成限流；`source = 'web'` 不计入该桶。

### MCP `pictostl_mcp`

- 工具名恰好第 7 节七个。
- `waitSeconds` 上限 60。
- HTTP **只用 mock** `/api/v1`，**不打**真实 pictostl.com。
- `upload_image` mock 断言：intent → PUT 无 Authorization → complete。
- `generate_model` 在 Agent 省略时仍向网站发送 `clientRequestId`，并在结果中返回。
- 客户端把 `INVALID_API_KEY` / `INSUFFICIENT_CREDITS` 补上官方 URL。
- 跟随 307 时请求 R2（或第二 host）不带 Bearer。
- README 含官网、价格、API Key、ToS、本地 stdio 说明。
- STL：已知 **原 GLB** fixture，默认最长边 100 mm（允许小数值误差）；`longestEdgeMm=50` 约为 100 mm 版本的一半。不要求与网页 preview 导出逐字节相同。
- `format=glb` 写入字节与 fixture 相同。

---

## 12. 建议文件

**网站（worktree，禁止直接改 `main`）**

| 文件 | 职责 |
| --- | --- |
| `src/config/db/schema.postgres.ts` 或模块 schema | `apikey`；`model_task` 增补列；API 上传表（若需要） |
| `src/config/db/migrations_postgres/0016_*.sql` | 迁移 |
| `src/modules/apikey/` 或 `src/modules/public-api/` | 生成/哈希/CRUD/限流 |
| `src/shared/http/public-api-auth.ts` | Bearer 管线与带 message 的错误 |
| `src/app/api/v1/**/route.ts` | 公开 REST（含 uploads/intents、complete、generations、assets） |
| `src/app/[locale]/(product)/settings/api-keys/` | 设置页 |
| `src/product/studio/product-routes.ts` | 路由 |
| `src/product/studio/product-header.tsx` | 头像菜单入口 |
| `src/product/commerce/commerce-shell.tsx` | Billing 旁入口 |
| `docs/product-requirements.md` | 产品基线补 API/MCP |

公开路由组装后调用 `createModelService` 与 credits，不复制 worker，不走 `modelActor`。

**MCP**

| 文件 | 职责 |
| --- | --- |
| `package.json` | `pictostl-mcp` bin / files / engines / publishConfig |
| `src/client.ts` | `{ ok, data }` / `{ ok: false, error }`；307 剥离 Bearer |
| `src/tools.ts` | 七个 `registerTool`；上传三步；补 `clientRequestId` |
| `src/stl.ts` | 原 GLB → 二进制 STL |
| `src/links.ts` | 官网链接 |
| `src/index.ts` | stdio |
| `test/*.test.ts` | mock HTTP + STL fixture |

---

## 13. 实施顺序

1. 网站 worktree：`apikey` 迁移 + `model_task` 增补 + 设置页（含头像菜单）。
2. 网站 `/api/v1`：account / options / uploads（intent+complete）/ generations（组装）/ assets，接现有 model3d。
3. 网站第 11 节测试。
4. `pictostl_mcp`：`git init`、MIT、七工具、mock 测试、STL fixture、可发布的 `package.json`。
5. 联调：本地网站建 Key，`PICTOSTL_API_BASE` 指本地，Basic 单图 → 轮询 → 本地下载 GLB 与 100 mm STL。
6. 发布 npm 后，Cursor 才能 `npx -y pictostl-mcp`。

网站代码进 `main` 只能本地 Git 合并。MCP 是独立 git 仓库，不要放进 `image_2_3d`。

---

## 14. 官方链接（MCP README 与错误文案）

| 用途 | URL |
| --- | --- |
| 站点 | https://pictostl.com |
| 注册 | https://pictostl.com 首页登录/注册 |
| API Key | https://pictostl.com/settings/api-keys |
| 价格 | https://pictostl.com/pricing |
| 条款 | https://pictostl.com/terms-of-service |
| 隐私 | https://pictostl.com/privacy-policy |

---

## 15. 产品文档同步（实现时）

更新 `image_2_3d/docs/product-requirements.md`：

- 新页 `/settings/api-keys`（登录、noindex）。
- 新公开 API `/api/v1`，仅 API Key。
- MCP 是该 API 的独立 **本地 stdio** 客户端；STL 在 MCP 本地由原 GLB 生成。
- 网站继续只提供 GLB 预览与浏览器 STL 导出（浏览器 STL 仍可来自 preview）。
