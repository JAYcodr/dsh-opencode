# Security

## 报告问题

请通过仓库的 **GitHub Security Advisories**（私有安全通告）报告漏洞，
不要在公开 issue 里粘贴 API key、凭据文件内容或完整日志。

## 凭据是怎么处理的

- 插件**不把 key 写进配置文件、日志或 HTTP 响应**。
- 两种来源，按优先级：
  1. 专用 key：在仪表「设置」页保存，写入 **DSH 凭据服务**的记录 `DSH_OPENCODE_PROBE_KEY`；
  2. provider 凭据：通过引用 `OPENCODE_GO_API_KEY` 解析（`probeKeyEnv` 可改）。
- key 只在宿主进程内存中用于单次请求的 `Authorization` 头；浏览器侧只拿到「是否已配置 / 来源 / 引用名」，拿不到值。
- 开关与间隔写在 `$DSH_HOME/plugin-data/dsh-opencode/settings.json`，只含布尔值和秒数，不含凭据。

## 如果你怀疑 key 泄漏

1. 去 OpenCode Console 轮换该 API key；
2. 在仪表「设置」页点「清除」删除专用 key，或从 `~/.dsh/.credentials.yaml` 移除相关记录；
3. 检查 shell 历史、issue/PR、聊天记录等插件目录之外的位置。

## 提交前自检

```bash
grep -rInE 'oc_sk_[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9]{10,}|BEGIN [A-Z ]*PRIVATE KEY' . --exclude-dir=node_modules --exclude-dir=dev/cache
```

仓库里的 `oc_sk_…` 只出现在 UI 占位提示文本中。
