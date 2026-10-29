# @yijianfa/cli

一键发 CLI 让本地 Agent 通过当前 Chrome 扩展执行填入和发布。CLI 不保存账号、会员凭证或平台 Cookie，也不会绕过扩展已有的登录、额度、确认和发布结果规则。

本地源码新增 `bridgeRoutingVersion=2`。新扩展注册持久身份后，每个 Native 连接使用独立端点；macOS 的浏览器可执行路径、扩展 ID、安装身份与普通/无痕上下文共同标识目标。同一 Chrome 或 ego lite 的多个 profile 可以同时在线。

要求 Node.js 20 或更高版本，运行时没有第三方依赖。0.3.7 支持本次个人声明覆盖，以及 macOS、Linux 与 Windows 的当前用户级 Google Chrome；旧扩展仍使用固定兼容桥；多个桥并存时，CLI 要求明确选择目标，不再自动优先商店版。视频号短视频 `prepare` 会拒绝超过 16 字或包含标点、emoji、特殊符号的短标题，不会静默改写输入。

## 安装

从源码目录安装：

```sh
npm install -g ./cli
yijianfa install-host
yijianfa doctor --wait 30
```

安装器会从 Chrome 已安装的一键发清单发现当前扩展 ID，并写入全部有效 origin；开发或受管环境也可显式传 `--extension-id`。`doctor --repair --wait 30` 可修复历史清单中的 ID 漂移。安装器会创建固定运行时 wrapper。macOS 清单写入：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.yijianfa.cli.json
```

Windows 会把清单与 `.cmd` host wrapper 写入：

```text
%USERPROFILE%\.yijianfa\native-host\
```

并注册当前用户键：

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.yijianfa.cli
```

Windows 上 CLI 与 host 通过当前用户 named pipe 通信，不依赖 `/tmp` 或 Unix socket。

卸载只删除本 CLI 创建的清单和 wrapper：

```sh
yijianfa uninstall-host
```

## 命令

所有成功命令只向 stdout 写一个 JSON 对象；失败只向 stderr 写一个错误 JSON 对象。没有进度条或普通文本混入 stdout。

| 命令 | 作用 |
| --- | --- |
| `help` / `--help` | 返回机器可读命令、schema 和退出码 |
| `version` / `--version` | 返回包和 Node.js 版本 |
| `bridges list [--browser-context regular|incognito]` | 列出在线桥；`identityVerified=false` 表示旧桥无法确认 profile 身份 |
| `doctor [--repair] [--wait [seconds]] [--timeout <ms>]` | 区分 host 缺失、配置错误、ID 漂移和扩展休眠；可自动修复配置 |
| `capabilities` | 返回扩展当前支持的内容类型、模式和平台 |
| `targets --platform jike\|juejin\|douban\|douban-group [--query <关键词>] [--content <即刻正文>]` | 获取目标，推荐优先并去重 |
| `transfer --from <来源> --to <目标> --url <链接> --mode fill\|publish` | 搬运文章；路线和操作以 `capabilities.transfer` 为准 |
| `prepare [--input <file>]` | 只在本机校验输入并流式计算素材大小、MIME、SHA256 |
| `fill [--input <file>] [--dry-run]` | 让扩展填入内容；`--dry-run` 不连接扩展 |
| `publish --yes [--input <file>] [--dry-run]` | 直接发布；即使 dry-run 也必须显式确认 `--yes` |
| `status [requestId]` | 查询任务状态；省略 ID 时列出当前连接的近期任务 |
| `cancel <requestId>` | 尝试取消尚未进入不可逆平台动作的任务 |
| `install-host [--extension-id <id>]` | 自动发现扩展 ID 并安装当前用户级 Native Messaging host |
| `uninstall-host` | 卸载当前用户级 host |

内容搬运前先运行 `yijianfa capabilities`，读取 `transfer.platforms` 和 `transfer.routes`。平台标识使用返回的 `id`，不要根据名称猜测。示例：

```sh
yijianfa transfer --bridge-id <bridge-id> --from x --to weixin --url 'https://x.com/example/status/123' --mode fill
yijianfa transfer --bridge-id <bridge-id> --from x --to feishu --url 'https://x.com/example/status/123' --mode publish --yes
```

`publish` 对飞书目标表示创建云文档，对其他支持发布的目标表示发布；`填入`、`发布`、`创建文档` 和 `创建云文档` 也可作为 `--mode` 的输入。`--dry-run` 读取在线能力并校验路线，不搬运；`--request-id` 可指定稳定任务标识。超时或连接中断后用同一身份和 requestId 查询 `status`，不要盲目换 ID 重发。包含视频的发布会退回填入并返回待检查。搬运进行中暂不支持安全取消。

`doctor` / `capabilities` / `prepare` / `fill` / `publish` / `status` / `cancel` 都支持 `--browser-context regular|incognito`。省略时始终是 `regular`；普通桥不可用时不会回退到无痕桥。

不传 `--input` 或传 `--input -` 时从 stdin 读取：

```sh
yijianfa fill --input ./task.json
printf '%s\n' '{"type":"dynamic","platforms":["jike"],"data":{"content":"你好"}}' \
  | yijianfa fill --dry-run
```

## 输入

### 本次个人声明

`prepare`、`fill`、`publish` 支持 `--personal-declaration true|false`，仅覆盖本次任务，不修改插件保存的默认设置：

```sh
yijianfa fill --input task.json --personal-declaration true
yijianfa fill --input task.json --personal-declaration false
```

JSON 也可在 `data` 中传 `"personalDeclaration": true` 或 `false`。省略时沿用目标插件的默认设置；命令参数优先于 JSON 中的任务级值。需要分别设置平台时，使用 `data.extra.<平台>.personalDeclaration`，平台级显式值优先于任务级值。所有值必须是布尔值，JSON 字符串 `"false"` 不接受。`false` 表示本次不自动选择声明，不会清除平台页面原有的声明。适用范围与插件一致：短视频支持小红书、抖音、视频号、快手、B站；图文/动态支持前四个平台。单站重试沿用本次任务快照。

```json
{
  "requestId": "8e1a05b7-2e9c-4f85-a8e8-6ec92348949d",
  "browserContext": "incognito",
  "comboName": "AI赛道图文",
  "type": "imageText",
  "data": {
    "title": "要填入的标题",
    "content": "要填入的正文"
  },
  "assets": [
    {
      "path": "/Users/me/Pictures/example.png",
      "role": "media",
      "type": "image/png",
      "sourceUrl": "https://example.com/original.png"
    }
  ]
}
```

- `requestId` 可省略；CLI 会生成 UUID。也可传 8 到 128 位的字母、数字、点、下划线、冒号或连字符安全标识。相同业务请求应复用同一 ID。
- `browserContext` 只能是 `regular` 或 `incognito`，省略时为 `regular`。如果同时传入 `--browser-context`，两者必须完全一致，否则在本机校验阶段拒绝。
- `comboName` 是插件里保存的发布组合名称。提供后可省略 `platforms`；扩展会读取该组合的平台顺序、公共标签、平台专属标签以及圈子/分组目标。运行 `yijianfa capabilities` 可读取当前可用的 `publishCombos`。
- `groupName` 可省略，只覆盖本次任务的 Chrome Tab 分组显示名；未传时使用组合名称。同名不会自动合并分组。
- 同一发布任务分多次执行时，首个 `fill` 或 `publish` 的回执 `result.tabGroupId` 可用于后续请求：在输入 JSON 传入 `"tabGroupId": 123`（替换为实际回执值），并沿用同一 `--bridge-id` 和 `--browser-context`。每次执行使用独立的 `requestId`，继续读取最新回执中的 `result.tabGroupId`。原分组关闭、浏览器会话变化或不在当前窗口时，会创建新分组并返回新标识；没有打开标签页或浏览器不支持分组时可能没有标识。不要根据名称猜测或复用其他任务的分组。
- `type` 是 `dynamic`、`imageText`、`article`或 `shortVideo`。
- `platforms` 与 `comboName` 至少提供一项。按组合发布时建议省略 `platforms`；若两者同时提供，平台集合必须与组合一致，实际执行顺序以组合为准。
- `data` 是传给扩展的 JSON 对象。
- 直接传 `platforms` 执行 `publish` 时必须提供 `data.publishGuard`；按 `comboName` 发布且未显式提供 guard 时，扩展会从组合目标生成 guard，并固定要求公开链接读回。所有平台使用所选浏览器上下文中用户已登录的账号，无需补填账号名称、显示名或昵称。旧 `expectedAccounts` 字段兼容接收但完全忽略，不做名称匹配；即刻目标来自组合或 `expectedTargets.jike`，两者冲突时会在打开平台页前拒绝。没有公开链接时返回 `needs_check`，不得按成功归档。
- 扩展 `0.1.31` 的动态 capabilities 包含 `weibo`、`toutiao`、`juejin`。三者支持 CLI `fill` 与 `publish --yes`；掘金指定圈子时可同时传 `extra.juejin.topic` 与 `publishGuard.expectedTargets.juejin` 做精确核对。
- `fill` 保持兼容，可不传 guard；一旦提供 `data.publishGuard`，仍校验圈子和公开链接配置，账号名称不参与校验。`capabilities` 返回 `accountPolicy=current_browser_session`、`accountNameRequired=false` 和 `expectedAccounts=deprecated_ignored`。
- `assets[].path` 必须是绝对路径且指向普通文件。`role` 只能是 `media`、`cover`、`horizontalCover` 或 `wordFile`，省略时为 `media`；`type` 省略时从文件头和扩展名识别；`sourceUrl` 只接受不含用户名/密码的 HTTP(S)。

### 圈子、话题与豆瓣小组（0.3.13）

先通过 `capabilities.targets` 核对扩展能力，再在同一 `--bridge-id` 和 `--browser-context` 下获取目标：

```sh
yijianfa targets --bridge-id <bridge-id> --browser-context regular --platform jike --content '准备发布的正文'
yijianfa targets --bridge-id <bridge-id> --browser-context regular --platform jike --query 'AI'
yijianfa targets --bridge-id <bridge-id> --browser-context regular --platform juejin
yijianfa targets --bridge-id <bridge-id> --browser-context regular --platform douban --query '生活'
yijianfa targets --bridge-id <bridge-id> --browser-context regular --platform douban-group
```

即刻正文推荐排在前面，订阅列表作为补充追加并按名称去重；不传正文时返回订阅与置顶列表。关键词搜索与正文推荐分别调用。掘金返回圈子所属分类；豆瓣不传关键词时返回热门话题。某个即刻来源不可用时返回 `warnings`，不要把补充列表当作完整推荐。

CLI 不会自动选择第一个候选，也不读取工作台当前选中的小组。即刻、掘金圈子分别填入 `data.extra.jike.topic`、`data.extra.juejin.topic`；豆瓣话题填入 `data.tags`。豆瓣小组将所选 `items[].selection` 原样填入 `data.extra.douban`：

```json
{
  "type": "dynamic",
  "platforms": ["douban"],
  "data": {
    "title": "帖子标题",
    "content": "帖子正文",
    "extra": { "douban": { "groupName": "厦门租房", "accountId": "从本次 targets 结果复制" } }
  }
}
```

`accountId` 是本次浏览器会话返回的小组归属标识，不是昵称。账号变化、小组名称重复或选择未生效都会阻止成功回执。小组要求分区而尚未选择、或缺少标题时，保留页面供手动完成，停止自动发布。`publish --yes` 仍需原有 `publishGuard`，不把选小组当作发布授权。旧扩展未声明 `targets.version=1` 或 `doubanGroupSelection.version=1` 时明确报错并要求更新扩展。

填入、发布、内容搬运共用扩展执行效果；彩虹边框随执行开始和结束。下拉框间距及宽度是工作台显示样式，不需要 CLI 参数。

### 平台特殊规范

X 文章正文自动填入前 25 张图片，独立封面不占名额。超出的图片在原位置替换为 `【超过25张图片上限，需人工替换】` 和原始图片地址，不再上传；本地素材保留绝对路径，方便手动补图。`prepare` / `fill --dry-run` 的 `data.xArticleImageOverflow` 返回超限图片的位置与地址。多平台任务仅在 X 插件适配器中处理，不影响其他平台。

部分平台（如 X 文章）对输入有额外要求（图片嵌入方式、宽高比处理等），不在上述通用格式中覆盖。构建输入前请先阅读对应平台指南：

| 平台 | 指南路径 |
|------|----------|
| X 文章 (`type: "article"`, `platforms: ["x"]`) | [`cli/skills/x-article/SKILL.md`](skills/x-article/SKILL.md) |

`prepare`、`fill --dry-run` 和 `publish --yes --dry-run` 返回 `status: "prepared_local"`。素材内容以流方式读取，不会为计算 SHA256 把整个大文件载入内存。

非 dry-run 的 `fill` / `publish` 不接受 `--timeout`：首次 execute 会一直保持素材服务，直到扩展给出终态。登录等待也属于同一请求；需要中止时，从另一个进程运行 `yijianfa cancel <requestId>`。

发布前 CLI 最多等待 35 秒，让 MV3 周期 alarm 唤醒 service worker 并恢复 Native 端口；这一阶段只发送只读 `doctor`，桥上线后只发送一次 `execute`，不会因唤醒超时重复发布。

执行中收到 `SIGINT` 或 `SIGTERM` 时，CLI 会先通过桥请求取消，并继续保留素材服务、等待原 execute 返回终态。不要用 `kill -9` 强杀执行进程；它无法协商取消，并可能让已开始的平台任务只能进入 `needs_check`。

## 输出和退出码

成功：

```json
{"ok":true,"command":"fill","result":{"status":"completed","requestId":"..."}}
```

失败：

```json
{"ok":false,"command":"publish","error":{"code":"CONFIRMATION_REQUIRED","message":"publish 必须显式传 --yes","hint":"..."}}
```

| 退出码 | 含义 |
| --- | --- |
| `0` | 命令成功 |
| `2` | 输入、参数或平台环境不支持 |
| `10` | `publish` 缺少显式确认 |
| `20` | 未登录或会话失效 |
| `21` | 额度不足 |
| `22` | 授权服务不可用，按 fail-closed 处理 |
| `30` | host、桥或扩展连接失败 |
| `40` | 执行失败、部分成功、需要人工检查或部分取消 |

## 多 profile 确定性连接（本地源码）

先运行 `node cli/bin/yijianfa.js bridges list`。选择目标扩展注册的 `bridgeId`：

```sh
node cli/bin/yijianfa.js doctor --bridge-id bridge-<32位十六进制标识> --wait 30
node cli/bin/yijianfa.js capabilities --bridge-id bridge-<32位十六进制标识>
node cli/bin/yijianfa.js fill --bridge-id bridge-<32位十六进制标识> --input task.json
node cli/bin/yijianfa.js status <requestId>
```

`--bridge-id` 可用于 doctor、capabilities、prepare、fill、publish、status、cancel，也可放在输入 JSON 的 `bridgeId`。输入与参数冲突会拒绝。`prepare` 和 `--dry-run` 保持离线，返回 `bridgeSelection.state=not_connected`，不能作为目标在线的证据。

扩展按普通/无痕分别保存安装 UUID，使用不同 storage.local 键，避免两种上下文首次初始化竞争。更新和后台重启保持身份；卸载或清除扩展存储会改变身份。复制 profile 导致相同身份同时在线时，CLI 拒绝自动选择。

可选 `--profile <别名>` 对应扩展本地 `cliBridgeProfileName` 设置。别名必须唯一；它不是 Chrome 的 `Default/Profile 1` 目录名，也不是账号昵称。首次配对需在目标 profile 的扩展中核对身份，不能凭任务空间名推断。两个扩展渠道的身份独立，不自动合并。

执行前先核实目标，等待休眠扩展恢复，再启动素材服务。execute、信号取消固定同一连接 instanceId；断开不转投其他桥、不自动重发任务。CLI 在私有运行目录保存 requestId 到稳定 bridgeId 的路由，后续 status/cancel 可在重连后回到同一目标。路由丢失时需显式提供目标；已有请求不能重新绑定到另一目标。

新桥的 execute/cancel 必须携带 `bridgeTarget`；host 与扩展均检查稳定身份和连接实例。任务 `bridgeId` 必须与 envelope 一致，并与 browserContext 一起参与摘要。旧任务仍用旧摘要；升级后查询旧任务，不要以同一 requestId 重新执行，否则可能返回摘要冲突。

旧 host/扩展仍可通过固定端点查询。`YIJIANFA_SOCKET_PATH` 可锁定兼容路径，但不能提供 profile 身份保证；新 CLI 不将它提升为已校验身份。新桥没有固定端口写入别名，旧 CLI 需升级才能执行。此改动只锁定 profile，平台当前登录账号变化仍沿用现有账号策略。

测试隔离可设置绝对路径 `YIJIANFA_RUNTIME_DIR`；CLI 与 host 必须使用同一目录。Unix 目录为 0700、socket 与登记/路由文件为 0600。登记文件不是信任依据，CLI 会向在线 host 握手确认；只清理本实例的端点和登记，不删除其他桥。Windows 使用独立 named pipe，登记文件放在用户临时目录。

## 桥协议 v1 与路由能力 v2

CLI 与 host 使用当前用户本机 IPC 的 NDJSON；传输仍为 protocolVersion=1，新路由通过登记身份和 bridgeTarget 协商。以下固定端点描述仅适用于旧桥。macOS/Linux 普通上下文保持 `/tmp/yijianfa-<uid>/bridge-v1.sock`，无痕上下文使用 `/tmp/yijianfa-<uid>/bridge-v1-incognito.sock`（商店版两者均带 `store` 标识）；Windows 在原 named pipe 后为无痕上下文加 `-incognito`。目录权限为 `0700`，socket 权限为 `0600`。请求 envelope：

```json
{"protocolVersion":1,"kind":"request","id":"transport-uuid","browserContext":"incognito","action":"execute","payload":{}}
```

扩展 action 为 `doctor`、`capabilities`、`execute`、`status` 和 `cancel`；新 host 另提供本地 `describe` 身份握手，不向扩展派发。`status` / `cancel` 的 payload 是 `{ "requestId": "..." }`；执行 payload 是：

```json
{
  "task": {
    "requestId": "...",
    "browserContext": "incognito",
    "comboName": "AI赛道图文",
    "groupName": "AI赛道图文",
    "type": "dynamic",
    "mode": "fill",
    "platforms": [],
    "data": {},
    "assets": [
      {
        "role": "media",
        "name": "example.png",
        "type": "image/png",
        "size": 1234,
        "sha256": "...",
        "blobUrl": "http://127.0.0.1:随机端口/随机令牌/..."
      }
    ],
    "confirmed": false,
    "payloadDigest": "..."
  }
}
```

host 与 Chrome 使用官方 Native Messaging 的“32 位本机字节序长度 + UTF-8 JSON”帧，单条消息严格小于 1 MiB。host 的 stdout 只写协议帧，日志只写 stderr，并通过 transport `id` 代理多个并发 CLI 请求。

`incognito: split` 下普通/无痕扩展后台共享 extension ID，因此每个 Native host 启动后先由扩展发送 `bridge_registration` 注册真实上下文，再绑定对应 IPC。host 会校验 envelope 上下文，扩展还会校验任务上下文；任一层不一致都返回 `browser_context_mismatch`。两个上下文使用独立任务存储键，不会互相恢复或取消任务。

CLI 自动打开工作台时会显式查找 `incognito` 标志相符的现有 Chrome 窗口。找不到时返回 `needs_check/browser_context_window_unavailable`，不会新建窗口或转投另一上下文。在选定上下文内使用当前已登录账号，不读取或比较昵称作为发布门槛；账号信息检测仅供展示及必要的平台元数据补全。平台登录失效、编辑器不可用、圈子不匹配及公开链接缺失仍按执行结果失败或返回 needs_check。

平台结果同时包含字段状态和生命周期：`filled`、`publish_clicked`、`published`、`failed`、`needs_check`。`published` 只在成功提示、业务回执、本人最新内容/公开 URL 等强信号，或编辑器清空与发布框关闭等两个独立弱信号组合成立时返回。公开链接可选返回为 `publicUrl`；正文、token、Cookie 和本机完整路径不会进入持久化结果。

### 素材安全边界

执行期间 CLI 临时启动 `127.0.0.1:0` HTTP 服务，每次使用随机 256 位令牌。服务只提供当前任务素材，支持 `OPTIONS`、`HEAD`、`GET` 和单段 `Range`，返回 CORS、Private Network Access 和 `no-store` 响应头；桥返回后立即关闭。

扩展只收到 `blobUrl`、文件名、MIME、大小、SHA256、role 和可选 `sourceUrl`，永远不会收到本机 `path`。`payloadDigest` 对 `{comboName?, groupName?, tabGroupId?, type, mode, platforms, data, assets}` 做对象键排序后计算 SHA256；平台顺序和素材顺序保持不变，随机 `blobUrl` 与本机路径不参与摘要。组合内容由扩展在执行时从本地存储读取，不由外部 CLI 伪造。

## 开发验证

```sh
node --test test/*.test.js
npm pack --dry-run
```

抖音、快手短视频可在任务 JSON 中设置 `data.allowDownload: false` 禁止下载，或设为 `true` 允许下载；省略时沿用扩展保存的偏好。单个平台可用 `data.extra.douyin.allowDownload` 或 `data.extra.kuaishou.allowDownload` 覆盖。此设置应用于填入和发布，不修改保存的偏好。

也可直接传命令参数，`prepare`、`fill`、`publish` 都支持，参数覆盖本次任务 JSON 的 `data.allowDownload`，平台级设置仍优先。

```bash
yijianfa fill --input task.json --allow-download false
yijianfa publish --input task.json --allow-download false --yes
```

### 飞书云文档连接

0.3.11 起，本机 host 可为扩展「内容搬运」处理飞书云文档创建。需另行安装并授权 `lark-cli`，在扩展内明确选择文档应用；所有业务命令固定传入所选 `--profile` 与 `--as user`，不会更改本机默认配置。此能力不增加对外 CLI 命令，不允许内容脚本调用，也不提供任意 shell、文件读取或文档覆盖。

图文先在扩展中清洗，图片通过绑定当前安装身份和普通/无痕上下文的 Native 通道分块暂存。创建前保存任务标识，创建后回读正文与图片；未知结果只查询原任务，不自动重建。临时素材在结束时清理，任务记录只保留结果与文档链接，不持久保存正文或凭证。

飞书文档连接兼容 Chrome 的精简 PATH，会查找 npm 用户安装目录并为子进程补齐 Node 路径。页面启动自动探测用户授权与文档权限；可在 `~/.yijianfa/feishu-document-connection.json` 保存已明确选择的 `profile`、`appId`、`userId`（身份元信息，不含凭证）作为文档用途连接。恢复时再次核对三者，不按当前默认应用或连接顺序切换身份。
