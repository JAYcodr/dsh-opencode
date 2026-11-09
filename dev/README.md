# dev（不在运行路径上）

- `host-smoke.mjs`：用假的 cordis ctx 跑 `apply`，捕获 `/dsh-opencode` 路由，
  检查状态/数据/Go 清单/额度/探针/设置/凭据接口。不设 `OCSW_TEST_KEY` 时只跑离线分支；
  设置后会用真实 Go key 跑一次探针与额度请求（约 $0.00001，仅手动运行）。
  ```bash
  OCSW_TEST_KEY=... node dev/host-smoke.mjs
  ```
  设置文件写到系统临时目录，不碰真实的 `~/.dsh/plugin-data`。
- `client-check.mjs`：迷你 React 渲染器 + `/state` 载荷，验证浏览器半边的加载、状态、数据、
  设置页、开关显隐、收起胶囊与错误态。
  ```bash
  curl -s "$DSH_WEB_URL/dsh-opencode/api/state" -o /tmp/state.json
  node dev/client-check.mjs /tmp/state.json
  ```
- `cache/`：开发时抓取的公开 JSON/HTML 样本（status、data、Go 模型清单、robots.txt 等），
  仅用于离线对拍，**已被 `.gitignore` 排除**，不入库；需要时重新抓一份即可。

测试里出现的 `test-key-*` 都是假值，真实 key 只从环境变量读取。
