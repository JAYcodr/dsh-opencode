# OpenCode 线路仪表（dsh-opencode）

> A floating meter for [opencode.ai](https://opencode.ai/status/) inside the DeepSeek Harness Web UI:
> link quality to opencode.ai, service status, Go plan allowance (5h / weekly / monthly), a real
> probe of the Go inference endpoint (TTFT, billing source, allowance), plus usage and cost data.
> MIT licensed — see [LICENSE](LICENSE). Not affiliated with OpenCode or Anomaly.

在 DeepSeek Harness 的 Web UI 边角挂一块小悬浮仪表，把「到 OpenCode 的线路」和「Go 套餐此刻通不通」放在同一个视线里：

1. **线路质量**：本机到 `opencode.ai` 的往返时延（每次抓取 `/status/api/status` 时现场测量），带滑窗均值、抖动、成功率与轮询进度。
2. **服务灯**：`opencode.ai/status` 公布的控制台 / 推理 / Go / 按量 / 免费状态。
3. **实测 GO（真探针）**：用 Go 套餐凭据发一次极小的流式请求，测**真实首字时延**、拿回**计费来源**（是不是真的走 `go`，还是掉到余额）、**本次计入额度**与 `x-opencode-log-id`；失败时给出分类原因（密钥 / 额度 / 限流 / 上游 / 超时）。
4. **Go 额度**：官方 usage 端点的实时读数——**5 小时窗口 / 本周 / 本月**三条进度条，带百分比、`limited` 状态与重置倒计时；任一窗口达到上限时胶囊灯也会变色。
5. **数据台账**：`opencode.ai/zh/data` 的用量排位、会话成本（`#session-cost`）、缓存命中、周留存、全站份额、地区分布；模型价格取自 Go 官方清单，并显示**当前时段倍率**（峰值 ×2 / 非峰值）。

## 安装

1. 发布到 npm 后，在 DSH 里用 Plugin Manager 搜索/安装 `dsh-opencode`；尚未发布时先用下面的目录方式。
2. 或者把本仓库克隆到任意可写目录，用 Plugin Manager 的「从目录安装 bundle」选中该目录（等价于 `plugin_manager` 的 `install_bundle`），DSH 会把它 link 进当前 profile。
3. 刷新 Web UI（⌘R / Ctrl+R），右上角出现悬浮仪表；没有的话重启一次 Harness 让客户端模块图重扫。
4. key：如果 profile 里已经有 `OPENCODE_GO_API_KEY`（使用 opencode-go provider 时通常都有），可直接用；否则在仪表「设置」页签保存一把有 Go 订阅的 key，或把 `probeKeyEnv` 指向你自己的凭据引用名。

> 插件只读 OpenCode 的公开/未文档化端点，端点可能随官方变更；本项目与 OpenCode、Anomaly 无隶属关系。

## 数据来源与频率

| 数据 | 地址 | 频率 |
|---|---|---|
| 实时状态 | `https://opencode.ai/status/api/status` | 60s |
| 用量数据 | `https://opencode.ai/data/index.json` | 300s |
| Go 模型/价格清单 | `https://opencode.ai/inference/go/v1/models` | 1800s |
| 实测探针 | `https://opencode.ai/inference/go/openai/v1/chat/completions` | 600s（可关，最低 120s） |
| Go 额度 | `https://opencode.ai/zen/go/v1/usage` | 120s（可关，最低 60s） |

- 只读公开 JSON、不抓页面；单线程、不重叠请求；失败按指数退避并尊重 `Retry-After`。
- 实测探针是唯一会花额度的请求：`max_tokens: 16`、输入一句 `Say ok`，一次约 **$0.00001**（计入 Go 月额度，`cost` 字段为 0）。每 10 分钟一次 ≈ **$0.001/天**。界面显示「今日 N 次 · 计入 $x」。
- 探针请求按官方对客户端的要求带插件 UA 和稳定的 `x-opencode-session`。
- 除探针外，数据只在宿主内存里缓存，不落盘。

## Go 额度是怎么来的

`GET https://opencode.ai/zen/go/v1/usage`（Bearer 同一把 Go key，只读、响应约 240 字节、`Cache-Control: no-store`）返回：

```json
{"usage":{
  "rolling":{"status":"ok","percent":1,"resetsAt":"…"},  // 5 小时窗口
  "weekly": {"status":"ok","percent":0,"resetsAt":"…"},
  "monthly":{"status":"ok","percent":9,"resetsAt":"…"}
}}
```

窗口规则见 [Go 文档](https://opencode.ai/docs/console/go#usage-limits)：5 小时最多用月额度的 20%、周 50%、月 100%，所以三条 `percent` 是各自窗口内的已用百分比。字段语义与 OpenCode 核心一致（`status: "ok" | "rate-limited"`），实现见 [PR #58694](https://github.com/anomalyco/opencode/pull/58694)。这个端点没有写进公开文档，所以插件对字段缺失做了容错：认不出来就显示「额度不可用」，不影响其它读数。

- `401`：key 失效；`403`：这把 key 没有 Go 订阅或不被工作区支持 —— 都会退避 30 分钟再试，并只在额度区块里提示一行。
- 该端点只返回百分比和重置时间，不返回明细；插件也只展示这些，不消耗额度。

## 开关与设置

- **标题旁两个显式开关**：`实测`（真实探针）、`额度`（Go 额度查询）。关掉后对应区块立即隐藏，宿主也会停掉对应的定时请求（实测不再花额度、额度不再轮询）；状态和本机时延不受影响。
- **设置页签**：两个开关 + 间隔（分钟）、专用 key 的保存/清除、当前 key 来源。间隔改动立即生效并持久化。
- **持久化位置**：开关与间隔写在 `$DSH_HOME/plugin-data/dsh-opencode/settings.json`（权限 600，原子写入）；专用 key 写在 DSH 凭据库的 `DSH_OPENCODE_PROBE_KEY`，不进配置文件、不回传浏览器、不出现在 `/api/state`。
- **key 优先级**：专用 key（UI 保存）→ provider 凭据（`OPENCODE_GO_API_KEY`）。设置页会显示当前实际使用的是哪一个。
- 输入合法 key（无空白、长度合理）并保存后立即重新探测；清除后回落到 provider key。
- 手动「刷新」按钮会同时刷新状态、用量数据与 Go 额度。

## 凭据是怎么用的

- 探针要一把能走 Go 套餐的 key。插件**不硬编码任何 key**，默认引用 profile 里 provider 已配置的 `OPENCODE_GO_API_KEY`（使用 opencode-go provider 时通常已存在），通过 DSH 凭据服务**每次请求时现取现用**。
- key 不下发给浏览器、不会进 `/api/state`、不写日志、不写配置。配置里只出现**引用名**。
- 想用独立的 key：在仪表「设置」页保存（写入凭据库的 `DSH_OPENCODE_PROBE_KEY`），或用任意别的引用名并把 `probeKeyEnv` 指向它。
- 读不到凭据时：不自动探测、不发任何请求，界面上写明「未配置 XXX」。

## 安全

- key 不写配置文件、不写日志、不出现在 `/api/state`；浏览器只看到「是否已配置 / 来源 / 引用名」。
- 专用 key 存在 DSH 凭据服务里；开关与间隔存在插件数据目录的 `settings.json`（只含布尔与秒数）。
- 发现安全问题请走私有渠道，详见 [SECURITY.md](SECURITY.md)。

## 使用

- 拖动标题栏移动；右上角 ⟳ 立即刷新，⌃ 收成小胶囊（胶囊本身也能拖：按住移动、轻点展开）。
- **收起后的胶囊灯 = 官方 Go 状态与最近一次实测结果的较差者**：官方说正常但你的 key/额度出问题时，胶囊也会变红。
- 状态页「实测 GO」里有「测一下」按钮（手动探测，30s 冷却）；自动探测按 `probeIntervalSeconds` 走，倒计时显示在发丝线上。
- 「Go 额度」区块显示 5 小时 / 本周 / 本月三条进度条与重置倒计时；≥85% 变黄，`rate-limited` 变红。
- 数据页「价格」一行显示 Go 官方现价 × 当前时段倍率（DeepSeek V4.1 Flash 工作日 UTC 01–04 / 06–10 为峰值 ×2）。
- 位置、折叠状态、页签、选中模型存在浏览器 `localStorage`；深浅色与语言（中/英）跟随 Harness。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖该行的 config：

```yaml
- id: dsh-opencode
  config:
    statusIntervalSeconds: 60      # 20–600
    dataIntervalSeconds: 300       # 60–3600
    requestTimeoutSeconds: 15      # 5–60
    probeSamples: 120              # 20–500（本地时延样本数）
    probeEnabled: true             # 关掉则完全不发推理请求
    probeIntervalSeconds: 600      # 120–3600
    probeKeyEnv: OPENCODE_GO_API_KEY  # 凭据引用名，不是 key 本身
    probeModel: deepseek-v4.1-flash
    probeTimeoutSeconds: 30        # 5–60
    goModelsIntervalSeconds: 1800  # 600–7200
    usageEnabled: true             # Go 额度查询（只读，不消耗额度）
    usageIntervalSeconds: 120      # 60–3600
```

## 接口（同源，仅供本插件的浏览器半边使用）

- `GET  /dsh-opencode/api/state` —— 合并后的状态 / 用量 / 清单 / 探针 / 额度 / 设置（不含 key）。
- `POST /dsh-opencode/api/probe` —— 手动探测，body 可带 `{"model":"..."}`；冷却 30s，运行中返回 409。
- `POST /dsh-opencode/api/settings` —— 开关与间隔（越界自动夹取，持久化）。
- `POST /dsh-opencode/api/key` / `DELETE /dsh-opencode/api/key` —— 写入/清除专用 key（走 DSH 凭据服务）。

## 实现

- 宿主半边 `index.js`：轮询 + 本地时延测量 + 流式探针（SSE 逐事件计时，取 `opencode.allowance` / `billing_source`）+ 同源路由。
- 浏览器半边 `client.js`：注册进 `shell.overlay`（Frame 级悬浮层），只用 `--dsw-alias-*` 主题 token，不引入任何 Harness Client 包。
- 图标 `icon.svg`：信号格 + 指示灯，原创。

## 开发自检（不在运行路径上）

```bash
# 宿主半边：假 ctx 跑 apply，检查状态/数据/清单/探针整形与冷却。
# 不设 OCSW_TEST_KEY 时验证「未配置凭据」分支；设了就跑一次真实探针（约 $0.00001）。
OCSW_TEST_KEY="$(cat /path/to/key)" node dev/host-smoke.mjs
node dev/host-smoke.mjs

# 浏览器半边：迷你 React 渲染器 + 真实 /state 载荷，检查加载/状态/数据/收起/错误态/手动探测。
curl -s "$DSH_WEB_URL/dsh-opencode/api/state" -o /tmp/ocsw-state.json
node dev/client-check.mjs /tmp/ocsw-state.json
```

`dev/` 的说明见 [dev/README.md](dev/README.md)；`dev/cache/` 是开发时落盘的公开样本，已被 `.gitignore` 排除，不参与运行也不入库。

## 收录到 DSH 插件市场

DSH 的市场读取用户配置的插件索引；要让别人搜到，有两条互补路径：

1. **社区精选列表（推荐）**：向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提一个 PR，只加一个文件 —— `data/plugins/JAYcodr__dsh-opencode.yml`。条目内容已放在本仓库 [docs/awesome-entry.yml](docs/awesome-entry.yml)，分类用 `usage`。要求：仓库创建满 1 天、加上 `dsh-plugin` topic、`package.json` 声明 `dsh.bundle`（本仓库都满足）。合并后索引/站点自动重建，用户端把 awesome-dsh-plugin 索引加进 `plugin_market.indexes` 即可搜到。
2. **npm 自动索引**：部分市场索引（如 "DSH Plugin Index"）每天自动扫描 npm 上可安装的 DSH bundle；发布 npm 包后会进入这份索引。注意：**npm 上的 `dsh-opencode` 已被其他作者占用**，若要发 npm 需要换一个包名（例如 `dsh-opencode-meter`），并把 `repository` 指回本仓库。仅收录到精选列表不依赖 npm。

## License

[MIT](LICENSE) © 2026 JAYcodr

本项目与 OpenCode（Anomaly）无隶属关系，仅读取其公开接口。
