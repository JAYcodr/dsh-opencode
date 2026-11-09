/**
 * OpenCode 线路仪表 · 浏览器半边
 *
 * 挂在 shell.overlay 的悬浮仪表：不嵌入网页、不复制官网样式，
 * 只把宿主半边整理好的读数画成一块小仪表：线路质量、服务灯、Go 通道读数，
 * 以及 opencode.ai/data 的台账（用量 / 会话成本 / 缓存 / 份额）。
 *
 * 数据全部来自同源 /dsh-opencode/api/*（宿主半边轮询并整形）。
 * 样式只用宿主主题 token（--dsw-alias-*），浅色/深色跟随主题自动切换。
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/dsh-opencode/api'
    const DEFAULT_MODEL = 'deepseek-v4.1-flash'
    const LS_UI = 'dsh-opencode.ui.v1'
    const LS_POS = 'dsh-opencode.pos.v1'

    /** 状态接口首次返回前的兜底模型清单（与 Go 套餐当前跟的六个模型一致）。 */
    const GO_FALLBACK = [
      'claude-haiku-5-5',
      'deepseek-v4.1-flash',
      'glm-5.3-flash',
      'gpt-6-luna',
      'mimo-v2.6-flash',
      'muse-spark-1.3-contributor',
    ]
    const MODEL_NAMES = {
      'claude-haiku-5-5': 'Claude Haiku 5.5',
      'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
      'glm-5.3-flash': 'GLM-5.3-Flash',
      'gpt-6-luna': 'GPT-6 Luna',
      'mimo-v2.6-flash': 'MiMo-V2.6-Flash',
      'muse-spark-1.3-contributor': 'Muse Spark 1.3 Contributor',
    }

    //#region 文案

    const DICT = {
      zh: {
        title: '线路仪表',
        tabStatus: '状态',
        tabData: '数据',
        secLine: '线路',
        secServices: '服务',
        secGo: '当前模型',
        secLedger: '模型台账',
        secRank: '本周用量榜',
        secShare: '全站份额',
        qualityFast: '优秀',
        qualityGood: '良好',
        qualityFair: '一般',
        qualityPoor: '较差',
        qualityUnstable: '不稳定',
        qualityDown: '中断',
        qualityUnknown: '待测',
        nextIn: '{s}s 后刷新',
        dueNow: '即将刷新',
        sampling: '采样中',
        avg: '均值 {v}',
        jitter: '抖动 ±{v}',
        success: '成功率 {v}',
        samples: '{v} 次采样',
        rttHint: '本机到 opencode.ai 的往返时延：发起请求到读完响应体，含 TLS 与服务器处理',
        ttftHint: 'opencode.ai 口径：最近 5 分钟内位首字时延',
        tpsHint: 'opencode.ai 口径：最近 5 分钟内位吐字速度',
        rankHint: '过去 7 天该模型在 OpenCode 全站的用量排位',
        secProbe: '实测 GO',
        probeTtft: '首字',
        probeAllowance: '计入额度',
        probeBilling: '计费来源',
        probeOk: '正常',
        probeAuth: '密钥失效',
        probeFunds: '额度不足',
        probeRateLimit: '限流',
        probeUpstream: '上游异常',
        probeNetwork: '网络失败',
        probeTimeout: '超时',
        probeModelMissing: '模型不可用',
        probeUnconfiguredShort: '未配置',
        probeHttpError: '异常',
        probeWaiting: '等待首次探测',
        probeUnconfigured: '未配置密钥',
        probeOfficial: '官方中位 {v}',
        probeNow: '测一下',
        probeRunning: '探测中…',
        probeDisabled: '自动探测已关',
        probeToday: '今日 {n} 次 · 计入 {v}',
        probePeak: '峰值 ×{f}',
        probeOffPeak: '非峰值',
        probePrice: 'Go 现价 {v}',
        probeCooldown: '冷却中，稍后再试',
        probeKeyHint: '未配置 {ref}，不会自动探测',
        probeLog: '日志 {id}',
        probeResult: '实测 {v}',
        secUsage: 'Go 额度',
        usageRolling: '5 小时',
        usageWeekly: '本周',
        usageMonthly: '本月',
        usageOk: '正常',
        usageLimited: '已达上限',
        usageResetIn: '{v} 后重置',
        usageAuth: '密钥失效',
        usageForbidden: '无 Go 订阅或权限不足',
        usageSchema: '额度响应格式变了',
        usageNotConfigured: '未配置凭据',
        usageDisabled: '额度查询已关',
        usageUnavailable: '额度不可用',
        usageUpdated: '更新 {time}',
        tabSettings: '设置',
        toggleProbe: '实测',
        toggleUsage: '额度',
        settingsProbe: '实测 GO',
        settingsUsage: 'Go 额度',
        settingsProbeHint: '关闭后不再发实测请求',
        settingsUsageHint: '关闭后不再查询额度',
        settingsInterval: '间隔',
        settingsMinutes: '分钟',
        settingsKey: '专用 key',
        settingsKeyCurrent: '当前使用：{v}',
        settingsKeyDedicated: '专用 key',
        settingsKeyProvider: 'provider key（{ref}）',
        settingsKeyNone: '未配置',
        settingsKeyPlaceholder: '粘贴 OpenCode key（oc_sk_…）',
        settingsSave: '保存',
        settingsClear: '清除',
        settingsSaving: '保存中…',
        settingsKeySaved: 'key 已保存到 DSH 凭据库',
        settingsKeyCleared: '专用 key 已清除',
        settingsHint: 'key 只存在 DSH 凭据库，在宿主内存里使用，不回传浏览器。',
        settingsSaved: '设置已保存',
        settingsError: '保存失败：{v}',
        settingsKeyError: 'key 保存失败：{v}',
        settingsBadKey: 'key 格式不对',
        settingsUnavailable: '凭据服务不可用',
        ttft: '首字 TTFT',
        tps: '吐字 tok/s',
        rank7: '7日排位',
        tokensWeek: '7日用量',
        tokensDay: '今日用量',
        sessionCost: '会话成本',
        cacheHit: '缓存命中',
        price: '价格',
        retention: '周留存',
        perSession: '≈{v} tokens/会话',
        priceMeta: '输入 / 输出 · 每 1M token',
        retentionRank: '全站 #{n}',
        rankMeta: '#{n} · {change}',
        viewData: '详情',
        viewAll: '全部',
        countries: '地区 {list}',
        updated: '更新 {time}',
        stale: '缓存',
        errorTitle: '宿主接口不可用',
        retry: '重试',
        refresh: '刷新',
        collapse: '收起',
        expand: '展开',
        expandHint: '点击展开 · 按住可拖动',
        selectModel: '选择 Go 模型',
        statusPage: '状态页',
        dataPage: '数据页',
        loading: '正在读取…',
        noData: '数据读取中…',
        offlineLine: '线路中断',
        servicesNone: '等待首个采样',
        goLamp: 'Go',
        planConsole: '控制台',
        planInference: '推理',
        planGo: 'Go',
        planPayg: '按量',
        planFree: '免费',
        stOperational: '正常',
        stDegraded: '降级',
        stOutage: '故障',
        stUnknown: '未知',
        overallOperational: '全部正常',
        overallDegraded: '部分降级',
        overallOutage: '服务中断',
        overallUnknown: '状态未知',
        reasonUpstream: '上游异常',
        reasonLatency: '响应变慢',
        reasonErrors: '错误率上升',
        reasonAvailability: '服务中断',
        errPrefix: '上次抓取失败：',
      },
      en: {
        title: 'Link meter',
        tabStatus: 'Status',
        tabData: 'Data',
        secLine: 'Link',
        secServices: 'Services',
        secGo: 'Current model',
        secLedger: 'Model ledger',
        secRank: 'Weekly usage',
        secShare: 'Market share',
        qualityFast: 'Fast',
        qualityGood: 'Good',
        qualityFair: 'Fair',
        qualityPoor: 'Poor',
        qualityUnstable: 'Unstable',
        qualityDown: 'Down',
        qualityUnknown: 'Warming',
        nextIn: 'refresh in {s}s',
        dueNow: 'refresh due',
        sampling: 'Sampling',
        avg: 'avg {v}',
        jitter: 'jitter ±{v}',
        success: 'success {v}',
        samples: '{v} samples',
        rttHint: 'Round trip from this machine to opencode.ai: request start to response body read, TLS and server time included',
        ttftHint: 'opencode.ai: median time to first token over the last 5 minutes',
        tpsHint: 'opencode.ai: median tokens per second over the last 5 minutes',
        rankHint: '7-day usage rank of this model across OpenCode',
        secProbe: 'Live probe',
        probeTtft: 'TTFT',
        probeAllowance: 'Allowance',
        probeBilling: 'Billed via',
        probeOk: 'OK',
        probeAuth: 'Bad key',
        probeFunds: 'No allowance',
        probeRateLimit: 'Rate limited',
        probeUpstream: 'Upstream error',
        probeNetwork: 'Network error',
        probeTimeout: 'Timeout',
        probeModelMissing: 'Model unavailable',
        probeUnconfiguredShort: 'No key',
        probeHttpError: 'Error',
        probeWaiting: 'Waiting for first probe',
        probeUnconfigured: 'No key',
        probeOfficial: 'official median {v}',
        probeNow: 'Probe',
        probeRunning: 'Probing…',
        probeDisabled: 'Auto probe off',
        probeToday: '{n} today · {v}',
        probePeak: 'peak ×{f}',
        probeOffPeak: 'off-peak',
        probePrice: 'Go price {v}',
        probeCooldown: 'Cooling down, retry soon',
        probeKeyHint: 'No {ref} credential; auto probe is off',
        probeLog: 'log {id}',
        probeResult: 'live {v}',
        secUsage: 'Go allowance',
        usageRolling: '5h',
        usageWeekly: 'Weekly',
        usageMonthly: 'Monthly',
        usageOk: 'OK',
        usageLimited: 'Rate limited',
        usageResetIn: 'resets in {v}',
        usageAuth: 'Bad key',
        usageForbidden: 'No Go plan or permission',
        usageSchema: 'Unexpected allowance payload',
        usageNotConfigured: 'No credential',
        usageDisabled: 'Allowance polling off',
        usageUnavailable: 'Allowance unavailable',
        usageUpdated: 'updated {time}',
        tabSettings: 'Settings',
        toggleProbe: 'Probe',
        toggleUsage: 'Quota',
        settingsProbe: 'Live probe',
        settingsUsage: 'Go allowance',
        settingsProbeHint: 'Turn off to stop sending probe requests',
        settingsUsageHint: 'Turn off to stop polling the allowance',
        settingsInterval: 'Interval',
        settingsMinutes: 'min',
        settingsKey: 'Dedicated key',
        settingsKeyCurrent: 'Using: {v}',
        settingsKeyDedicated: 'dedicated key',
        settingsKeyProvider: 'provider key ({ref})',
        settingsKeyNone: 'not configured',
        settingsKeyPlaceholder: 'Paste an OpenCode key (oc_sk_…)',
        settingsSave: 'Save',
        settingsClear: 'Clear',
        settingsSaving: 'Saving…',
        settingsKeySaved: 'Key saved to the DSH credential store',
        settingsKeyCleared: 'Dedicated key cleared',
        settingsHint: 'The key lives in the DSH credential store, is used only in the Host, and never returns to the browser.',
        settingsSaved: 'Saved',
        settingsError: 'Save failed: {v}',
        settingsKeyError: 'Key save failed: {v}',
        settingsBadKey: 'Malformed key',
        settingsUnavailable: 'Credential store unavailable',
        ttft: 'TTFT',
        tps: 'tok/s',
        rank7: '7d rank',
        tokensWeek: '7-day usage',
        tokensDay: 'Today',
        sessionCost: 'Cost / session',
        cacheHit: 'Cache hit',
        price: 'Price',
        retention: 'Weekly retention',
        perSession: '≈{v} tokens/session',
        priceMeta: 'input / output · per 1M tokens',
        retentionRank: 'rank #{n}',
        rankMeta: '#{n} · {change}',
        viewData: 'data',
        viewAll: 'all',
        countries: 'Regions {list}',
        updated: 'updated {time}',
        stale: 'cached',
        errorTitle: 'Host route unavailable',
        retry: 'Retry',
        refresh: 'Refresh',
        collapse: 'Collapse',
        expand: 'Expand',
        expandHint: 'Click to expand · drag to move',
        selectModel: 'Select a Go model',
        statusPage: 'status',
        dataPage: 'data',
        loading: 'Reading…',
        noData: 'Reading data…',
        offlineLine: 'Link down',
        servicesNone: 'waiting for first sample',
        goLamp: 'Go',
        planConsole: 'Console',
        planInference: 'Inference',
        planGo: 'Go',
        planPayg: 'PAYG',
        planFree: 'Free',
        stOperational: 'Operational',
        stDegraded: 'Degraded',
        stOutage: 'Outage',
        stUnknown: 'Unknown',
        overallOperational: 'All systems operational',
        overallDegraded: 'Partially degraded',
        overallOutage: 'Outage',
        overallUnknown: 'Status unknown',
        reasonUpstream: 'upstream issue',
        reasonLatency: 'slow responses',
        reasonErrors: 'errors',
        reasonAvailability: 'availability',
        errPrefix: 'Last fetch failed: ',
      },
    }

    function makeT(lang) {
      const dict = DICT[lang] || DICT.zh
      return (key, vars) => {
        let text = dict[key] ?? DICT.zh[key] ?? key
        if (vars) {
          for (const name of Object.keys(vars)) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]))
        }
        return text
      }
    }

    function detectLang(ctx) {
      try {
        const locale = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : null
        const snapshot = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null
        if (snapshot && typeof snapshot.active === 'string' && snapshot.active) {
          return /^zh/i.test(snapshot.active) ? 'zh' : 'en'
        }
      } catch {
        // 语言服务不在时退回浏览器语言
      }
      if (typeof navigator !== 'undefined' && /^zh/i.test(String(navigator.language || ''))) return 'zh'
      return 'en'
    }

    //#endregion

    //#region 数值格式

    function fmtTokens(value) {
      if (!Number.isFinite(value)) return '—'
      const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
      for (const [size, suffix] of units) {
        if (Math.abs(value) >= size) {
          const scaled = value / size
          return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`
        }
      }
      return String(Math.round(value))
    }

    function fmtMs(value) {
      if (!Number.isFinite(value)) return '—'
      return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
    }

    function fmtSeconds(ms) {
      if (!Number.isFinite(ms)) return '—'
      return `${(ms / 1000).toFixed(2)}`
    }

    function fmtUsd(value) {
      if (!Number.isFinite(value)) return '—'
      if (value >= 0.1) return `$${value.toFixed(2)}`
      if (value >= 0.01) return `$${value.toFixed(4).replace(/0+$/, '')}`
      if (value >= 0.0001) return `$${value.toFixed(5).replace(/0+$/, '')}`
      if (value === 0) return '$0'
      return `$${value.toFixed(6).replace(/0+$/, '')}`
    }

    function fmtPct(value) {
      if (!Number.isFinite(value)) return '—'
      return `${value.toFixed(1)}%`
    }

    function fmtPctChange(value) {
      if (!Number.isFinite(value)) return null
      return `${value > 0 ? '+' : ''}${value}%`
    }

    function fmtTime(timestamp) {
      if (!Number.isFinite(timestamp)) return '—'
      try {
        return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      } catch {
        return '—'
      }
    }

    function fmtDateUtc(iso) {
      if (typeof iso !== 'string' || !iso) return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      try {
        return date.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    /** 探针额度通常只有几美分以下，保留到 7 位小数才看得见。 */
    function fmtTinyUsd(value) {
      if (!Number.isFinite(value)) return '—'
      if (value === 0) return '$0'
      if (value >= 0.001) return `$${value.toFixed(4)}`
      if (value >= 0.0001) return `$${value.toFixed(5).replace(/0+$/, '')}`
      return `$${value.toFixed(7).replace(/0+$/, '')}`
    }

    //#endregion

    //#region 状态映射

    function statusKey(status) {
      if (status === 'operational' || status === 'degraded' || status === 'outage') return status
      return 'unknown'
    }

    function lampTone(status) {
      const key = statusKey(status)
      if (key === 'operational') return 'ok'
      if (key === 'degraded') return 'warn'
      if (key === 'outage') return 'bad'
      return 'idle'
    }

    function qualityTone(quality) {
      if (quality === 'fast' || quality === 'good') return 'ok'
      if (quality === 'fair' || quality === 'poor' || quality === 'unstable') return 'warn'
      if (quality === 'down') return 'bad'
      return 'idle'
    }

    function qualityLabelKey(quality) {
      switch (quality) {
        case 'fast': return 'qualityFast'
        case 'good': return 'qualityGood'
        case 'fair': return 'qualityFair'
        case 'poor': return 'qualityPoor'
        case 'unstable': return 'qualityUnstable'
        case 'down': return 'qualityDown'
        default: return 'qualityUnknown'
      }
    }

    function statusLabelKey(status) {
      const key = statusKey(status)
      if (key === 'operational') return 'stOperational'
      if (key === 'degraded') return 'stDegraded'
      if (key === 'outage') return 'stOutage'
      return 'stUnknown'
    }

    function overallLabelKey(status) {
      const key = statusKey(status)
      if (key === 'operational') return 'overallOperational'
      if (key === 'degraded') return 'overallDegraded'
      if (key === 'outage') return 'overallOutage'
      return 'overallUnknown'
    }

    function probeTone(result) {
      if (!result) return 'idle'
      if (result.ok) return 'ok'
      if (result.outcome === 'rate-limit') return 'warn'
      if (result.outcome === 'unconfigured') return 'idle'
      return 'bad'
    }

    function probeOutcomeKey(outcome) {
      switch (outcome) {
        case 'ok': return 'probeOk'
        case 'auth': return 'probeAuth'
        case 'funds': return 'probeFunds'
        case 'rate-limit': return 'probeRateLimit'
        case 'upstream': return 'probeUpstream'
        case 'network': return 'probeNetwork'
        case 'timeout': return 'probeTimeout'
        case 'model': return 'probeModelMissing'
        case 'unconfigured': return 'probeUnconfiguredShort'
        default: return 'probeHttpError'
      }
    }

    /** 把「还有多久」写成短中文/英文：3 小时 12 分、2 天 5 小时。 */
    function fmtUntil(timestamp) {
      if (!Number.isFinite(timestamp)) return '—'
      const remaining = timestamp - Date.now()
      if (remaining <= 0) return '—'
      const minutes = Math.round(remaining / 60000)
      if (minutes < 60) return `${minutes} min`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`
      const days = Math.floor(hours / 24)
      const restHours = hours % 24
      return restHours ? `${days} d ${restHours} h` : `${days} d`
    }

    function usageTone(meter) {
      if (!meter) return 'idle'
      if (meter.status === 'rate-limited') return 'bad'
      if (Number.isFinite(meter.percent) && meter.percent >= 85) return 'warn'
      return 'ok'
    }

    function usageErrorMessage(error, t) {
      if (!error) return ''
      if (error.outcome === 'unconfigured') return `${t('usageNotConfigured')} · ${error.message || ''}`
      if (error.outcome === 'auth') return t('usageAuth')
      if (error.outcome === 'forbidden') return t('usageForbidden')
      if (error.outcome === 'schema') return t('usageSchema')
      if (error.outcome === 'rate-limit') return t('probeRateLimit')
      if (error.outcome === 'upstream') return t('probeUpstream')
      if (error.outcome === 'network' || error.outcome === 'timeout') return t('probeNetwork')
      return error.message || error.outcome
    }

    function statusRank(status) {
      const key = statusKey(status)
      if (key === 'outage') return 3
      if (key === 'degraded') return 2
      if (key === 'unknown') return 1
      return 0
    }

    /** 胶囊灯取「官方 Go 状态」与「实测结果」中较差的一个。 */
    function worstStatus(a, b) {
      return statusRank(a) >= statusRank(b) ? a : b
    }

    function reasonLabel(t, reason) {
      if (!reason || reason === 'none') return ''
      if (reason === 'upstream') return t('reasonUpstream')
      if (reason === 'latency') return t('reasonLatency')
      if (reason === 'errors') return t('reasonErrors')
      if (reason === 'availability') return t('reasonAvailability')
      return String(reason)
    }

    //#endregion

    //#region 样式

    const CSS = `
.ocsw-root{position:fixed;z-index:60;pointer-events:none;width:max-content;max-width:100vw;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.ocsw-card{pointer-events:auto;width:304px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.10);overflow:hidden;user-select:none}
.ocsw-head{display:flex;align-items:center;gap:7px;padding:9px 10px 8px 12px;cursor:grab;border-bottom:1px solid var(--dsw-alias-border-l1);touch-action:none}
.ocsw-head:active{cursor:grabbing}
.ocsw-title{flex:1;min-width:0;font-size:11.5px;font-weight:600;letter-spacing:.01em;display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden}
.ocsw-title i{font-style:normal;font-weight:400;font-size:8.5px;letter-spacing:.16em;color:var(--dsw-alias-label-secondary);text-transform:uppercase;flex:none}
.ocsw-actions{display:flex;gap:1px;flex:none}
.ocsw-btn{width:22px;height:22px;display:grid;place-items:center;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;padding:0}
.ocsw-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ocsw-btn svg{width:13px;height:13px;display:block}
.ocsw-btn[data-busy="true"] svg{animation:ocsw-spin .9s linear infinite}
.ocsw-lamp{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-idle-primary) 16%,transparent);animation:ocsw-breathe 3s ease-in-out infinite}
.ocsw-lamp[data-state="operational"]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent)}
.ocsw-lamp[data-state="degraded"]{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}
.ocsw-lamp[data-state="outage"]{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}
.ocsw-modelbar{display:flex;align-items:center;gap:6px;padding:8px 12px 7px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ocsw-modelbar .tag{font:8.5px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.12em;color:var(--dsw-alias-label-secondary);flex:none;text-transform:uppercase}
.ocsw-selectwrap{position:relative;flex:1;min-width:0}
.ocsw-selectwrap::after{content:"";position:absolute;right:8px;top:50%;width:5px;height:5px;border-right:1px solid var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-label-secondary);transform:translateY(-72%) rotate(45deg);pointer-events:none}
.ocsw-select{width:100%;appearance:none;-webkit-appearance:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 22px 4px 8px;font:10.5px/1.45 ui-monospace,"SF Mono",Menlo,monospace;cursor:pointer;outline:none;text-overflow:ellipsis}
.ocsw-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.ocsw-tabs{display:flex;align-items:center;gap:2px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 36%,transparent)}
.ocsw-tab{position:relative;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:6px 8px 7px;cursor:pointer}
.ocsw-tab:hover{color:var(--dsw-alias-label-primary)}
.ocsw-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.ocsw-tab[aria-selected="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:1.5px;background:var(--dsw-alias-label-primary);border-radius:1px}
.ocsw-tabs-model{margin-left:auto;font:8.5px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:118px;text-align:right}
.ocsw-body{padding:0 12px;max-height:346px;overflow:auto;overscroll-behavior:contain;flex:1 1 auto;min-height:0}
.ocsw-body::-webkit-scrollbar{width:6px}
.ocsw-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:3px}
.ocsw-sec{padding:9px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ocsw-sec:last-child{border-bottom:0}
.ocsw-secrow{display:flex;align-items:center;gap:6px;margin-bottom:5px}
.ocsw-lab{font-size:10px;font-weight:500;letter-spacing:.02em;display:flex;align-items:baseline;gap:5px;flex:1;min-width:0}
.ocsw-lab i{font-style:normal;font:8px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.14em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.ocsw-chip{font-size:9.5px;font-weight:500;padding:1.5px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}
.ocsw-chip[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.ocsw-chip[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.ocsw-chip[data-tone="bad"]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.ocsw-main{display:flex;align-items:baseline;gap:3px;margin:1px 0 4px}
.ocsw-main b{font:500 21px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.ocsw-main span{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.ocsw-main em{margin-left:auto;font-style:normal;font:9.5px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ocsw-spark{position:relative;height:34px;margin:2px 0 4px}
.ocsw-spark-svg{display:block;width:100%;height:34px}
.ocsw-spark-line{fill:none;stroke:var(--dsw-alias-state-success-primary);stroke-width:1.25;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round}
.ocsw-spark-line[data-quality="fair"],.ocsw-spark-line[data-quality="poor"],.ocsw-spark-line[data-quality="unstable"]{stroke:var(--dsw-alias-state-warn-primary)}
.ocsw-spark-line[data-quality="down"]{stroke:var(--dsw-alias-state-error-primary)}
.ocsw-spark-line[data-quality="unknown"]{stroke:var(--dsw-alias-state-idle-primary)}
.ocsw-spark-area{stroke:none;fill:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.ocsw-spark-area[data-quality="fair"],.ocsw-spark-area[data-quality="poor"],.ocsw-spark-area[data-quality="unstable"]{fill:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.ocsw-spark-area[data-quality="down"]{fill:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}
.ocsw-spark-base{stroke:var(--dsw-alias-border-l1);stroke-width:1;vector-effect:non-scaling-stroke;stroke-dasharray:2 3}
.ocsw-spark-dot{position:absolute;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,transparent);animation:ocsw-blink 2.4s ease-in-out infinite}
.ocsw-spark-dot[data-quality="fair"],.ocsw-spark-dot[data-quality="poor"],.ocsw-spark-dot[data-quality="unstable"]{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 22%,transparent)}
.ocsw-spark-dot[data-quality="down"]{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent)}
.ocsw-spark-dot[data-quality="unknown"]{background:var(--dsw-alias-state-idle-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-idle-primary) 22%,transparent)}
.ocsw-spark-empty{display:grid;place-items:center;height:34px;margin:2px 0 4px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);color:var(--dsw-alias-label-secondary);font-size:9px;letter-spacing:.06em}
.ocsw-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:9.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ocsw-countdown{height:2px;border-radius:1px;background:var(--dsw-alias-border-l1);margin-top:7px;overflow:hidden}
.ocsw-countdown-fill{display:block;height:100%;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);transition:width .5s linear;border-radius:1px}
.ocsw-lamps{display:flex;gap:4px;flex-wrap:wrap}
.ocsw-lamp-item{display:flex;align-items:center;gap:4px;padding:2.5px 5px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ocsw-lamp-item .ocsw-lamp{width:5px;height:5px;box-shadow:none;animation:none}
.ocsw-metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:8px}
.ocsw-metric{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 62%,transparent);border-radius:7px;padding:5px 6px;min-width:0}
.ocsw-metric b{display:block;font:500 13px/1.2 ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ocsw-metric b small{font-size:8.5px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:1px}
.ocsw-metric[data-tone="warn"] b{color:var(--dsw-alias-state-warn-primary)}
.ocsw-metric[data-tone="bad"] b{color:var(--dsw-alias-state-error-primary)}
.ocsw-metric span{display:block;font-size:8.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ocsw-dataline{display:flex;align-items:baseline;gap:6px;margin-top:8px;font-size:9.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.ocsw-dataline b{font-weight:500;color:var(--dsw-alias-label-primary);font-family:ui-monospace,"SF Mono",Menlo,monospace}
.ocsw-link{margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:9.5px;cursor:pointer;padding:0;white-space:nowrap}
.ocsw-link:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px}
.ocsw-toggles{display:flex;align-items:center;gap:3px;flex:none}
.ocsw-chipbtn{display:flex;align-items:center;gap:3px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:9px;line-height:1.4;padding:2px 5px;border-radius:5px;cursor:pointer;white-space:nowrap}
.ocsw-chipbtn[data-on="true"]{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}
.ocsw-chipbtn:hover{border-color:var(--dsw-alias-border-l2)}
.ocsw-chipbtn .dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.ocsw-chipbtn[data-on="true"] .dot{background:var(--dsw-alias-state-success-primary)}
.ocsw-settings{padding:8px 0 12px;display:flex;flex-direction:column;gap:11px}
.ocsw-set-row{display:flex;align-items:center;gap:8px;min-width:0}
.ocsw-set-label{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.ocsw-set-label span{font-size:10px;color:var(--dsw-alias-label-primary)}
.ocsw-set-label small{font-size:8.5px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.ocsw-set-control{display:flex;align-items:center;gap:5px;flex:none}
.ocsw-input{width:38px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:5px;padding:2px 4px;font:9.5px/1.5 ui-monospace,"SF Mono",Menlo,monospace;outline:none;text-align:right}
.ocsw-input:focus{border-color:var(--dsw-alias-brand-primary)}
.ocsw-input:disabled{opacity:.5}
.ocsw-unit{font-size:9px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ocsw-switch{position:relative;width:26px;height:14px;border-radius:999px;background:var(--dsw-alias-border-l2);border:0;padding:0;cursor:pointer;flex:none;transition:background .15s ease}
.ocsw-switch::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.ocsw-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.ocsw-switch[aria-checked="true"]::after{transform:translateX(12px)}
.ocsw-switch:disabled{opacity:.5;cursor:default}
.ocsw-set-sep{height:1px;background:var(--dsw-alias-border-l1);margin:1px 0}
.ocsw-keyline{display:flex;align-items:center;gap:4px;margin-top:5px}
.ocsw-keyinput{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 6px;font:9.5px/1.5 ui-monospace,"SF Mono",Menlo,monospace;outline:none}
.ocsw-keyinput:focus{border-color:var(--dsw-alias-brand-primary)}
.ocsw-keyhint{font-size:8.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:5px}
.ocsw-notice{font-size:9px;line-height:1.5;color:var(--dsw-alias-state-success-primary)}
.ocsw-notice[data-tone="bad"]{color:var(--dsw-alias-state-error-primary)}
.ocsw-action{flex:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:9.5px;line-height:1.4;padding:2.5px 7px;border-radius:6px;cursor:pointer;white-space:nowrap}
.ocsw-action:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.ocsw-action:disabled{opacity:.5;cursor:default}
.ocsw-rows{display:flex;flex-direction:column}
.ocsw-row{display:flex;align-items:baseline;gap:6px;padding:3.5px 0;border-bottom:1px dashed color-mix(in srgb,var(--dsw-alias-border-l1) 72%,transparent);font-size:10px}
.ocsw-row:last-child{border-bottom:0}
.ocsw-row .k{color:var(--dsw-alias-label-secondary);flex:none;width:62px}
.ocsw-row .v{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);white-space:nowrap}
.ocsw-row .x{margin-left:auto;font-size:9px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ocsw-row .x[data-dir="up"]{color:var(--dsw-alias-state-success-primary)}
.ocsw-row .x[data-dir="down"]{color:var(--dsw-alias-state-error-primary)}
.ocsw-bar{position:relative;height:2px;border-radius:1px;background:var(--dsw-alias-border-l1);margin-top:4px;overflow:hidden}
.ocsw-bar i{display:block;height:100%;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,transparent);border-radius:1px}
.ocsw-leader{display:flex;flex-direction:column;gap:1px;margin-top:2px}
.ocsw-lrow{position:relative;display:flex;align-items:baseline;gap:6px;padding:3px 0 4px;font-size:10px;min-width:0}
.ocsw-lrow::before{content:"";position:absolute;left:0;bottom:0;height:2px;width:var(--w,0%);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent);border-radius:1px}
.ocsw-lrow .r{width:15px;flex:none;font:9px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.ocsw-lrow .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ocsw-lrow .t{font:9.5px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none}
.ocsw-lrow .d{width:36px;text-align:right;font:9px/1 ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums;flex:none}
.ocsw-lrow .d[data-dir="up"]{color:var(--dsw-alias-state-success-primary)}
.ocsw-lrow .d[data-dir="down"]{color:var(--dsw-alias-state-error-primary)}
.ocsw-usage{display:flex;flex-direction:column;gap:5px;margin-top:3px}
.ocsw-usage-row{display:flex;align-items:center;gap:6px;font-size:9.5px;color:var(--dsw-alias-label-secondary);min-width:0}
.ocsw-usage-row .n{width:46px;flex:none;color:var(--dsw-alias-label-primary)}
.ocsw-usage-row .b{flex:1;height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;min-width:24px}
.ocsw-usage-row .b i{display:block;height:100%;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,transparent)}
.ocsw-usage-row .b[data-tone="warn"] i{background:var(--dsw-alias-state-warn-primary)}
.ocsw-usage-row .b[data-tone="bad"] i{background:var(--dsw-alias-state-error-primary)}
.ocsw-usage-row .v{width:34px;flex:none;text-align:right;font:9.5px/1 ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.ocsw-usage-row .v[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.ocsw-usage-row .v[data-tone="bad"]{color:var(--dsw-alias-state-error-primary)}
.ocsw-usage-row .r{width:84px;flex:none;text-align:right;font-size:9px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ocsw-share{display:flex;flex-direction:column;gap:3px;margin-top:2px}
.ocsw-share-row{display:flex;align-items:center;gap:6px;font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.ocsw-share-row .n{width:52px;flex:none;color:var(--dsw-alias-label-primary)}
.ocsw-share-row .b{flex:1;height:3px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden}
.ocsw-share-row .b i{display:block;height:100%;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 66%,transparent)}
.ocsw-share-row .v{width:38px;text-align:right;font:9px/1 ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.ocsw-foot{display:flex;align-items:center;gap:8px;padding:6px 12px 7px;border-top:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 34%,transparent);font-size:9px;color:var(--dsw-alias-label-secondary)}
.ocsw-foot a{color:inherit;text-decoration:none}
.ocsw-foot a:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px}
.ocsw-foot .time{margin-left:auto;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.ocsw-alert{display:flex;gap:6px;align-items:flex-start;margin:8px 0 0;padding:6px 8px;border-radius:7px;font-size:9.5px;line-height:1.45;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);word-break:break-word}
.ocsw-loading{display:grid;place-items:center;height:88px;color:var(--dsw-alias-label-secondary);font-size:10px;letter-spacing:.06em}
.ocsw-pill{pointer-events:auto;display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 14px rgba(0,0,0,.10),0 1px 3px rgba(0,0,0,.08);color:var(--dsw-alias-label-primary);font:10px/1 ui-monospace,"SF Mono",Menlo,monospace;cursor:grab;font-variant-numeric:tabular-nums;user-select:none;touch-action:none;width:max-content;min-width:max-content;max-width:calc(100vw - 24px);white-space:nowrap}
.ocsw-pill:active{cursor:grabbing}
.ocsw-pill:hover{border-color:var(--dsw-alias-border-l2)}
.ocsw-pill > *{flex:none}
.ocsw-pill .ocsw-lamp{width:6px;height:6px;box-shadow:none;animation:none}
.ocsw-pill .sep{width:1px;height:9px;background:var(--dsw-alias-border-l1);flex:none}
.ocsw-pill .go{color:var(--dsw-alias-label-secondary)}
.ocsw-pill .go b{color:var(--dsw-alias-label-primary);font-weight:500}
@keyframes ocsw-blink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ocsw-breathe{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes ocsw-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ocsw-lamp,.ocsw-spark-dot,.ocsw-btn[data-busy="true"] svg{animation:none!important}.ocsw-countdown-fill{transition:none!important}}
`

    //#endregion

    //#region 宿主状态

    function useHostState() {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [probing, setProbing] = useState(false)
      const [probeError, setProbeError] = useState(null)
      const [settingsBusy, setSettingsBusy] = useState(false)
      const [settingsError, setSettingsError] = useState(null)
      const [keyBusy, setKeyBusy] = useState(false)
      const [keyError, setKeyError] = useState(null)
      const [keyNotice, setKeyNotice] = useState(null)
      const aliveRef = useRef(true)

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${API}/state`, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (!aliveRef.current) return
          setState(payload)
          setError(null)
        } catch (caught) {
          if (aliveRef.current) setError(String((caught && caught.message) || caught))
        }
      }, [])

      const refresh = useCallback(async () => {
        setRefreshing(true)
        try {
          const response = await fetch(`${API}/refresh`, { method: 'POST', cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (!aliveRef.current) return
          setState(payload)
          setError(null)
        } catch (caught) {
          if (aliveRef.current) setError(String((caught && caught.message) || caught))
        } finally {
          if (aliveRef.current) setRefreshing(false)
        }
      }, [])

      const probeNow = useCallback(async (model) => {
        setProbing(true)
        setProbeError(null)
        try {
          const response = await fetch(`${API}/probe`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ model: model || undefined }),
          })
          let payload = null
          try {
            payload = await response.json()
          } catch {
            payload = null
          }
          if (payload && payload.liveProbe && aliveRef.current) setState(payload)
          if (!response.ok) {
            const code = payload && (payload.error || `HTTP ${response.status}`)
            if (aliveRef.current) setProbeError(String(code))
          }
        } catch (caught) {
          if (aliveRef.current) setProbeError(String((caught && caught.message) || caught))
        } finally {
          if (aliveRef.current) setProbing(false)
        }
      }, [])

      const post = useCallback(async (path, method, body) => {
        try {
          const response = await fetch(`${API}${path}`, {
            method,
            headers: body === undefined ? undefined : { 'content-type': 'application/json' },
            cache: 'no-store',
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          let payload = null
          try {
            payload = await response.json()
          } catch {
            payload = null
          }
          if (payload && payload.settings && aliveRef.current) setState(payload)
          if (!response.ok) {
            return { ok: false, error: String((payload && (payload.error || payload.message)) || `HTTP ${response.status}`) }
          }
          return { ok: true, payload }
        } catch (caught) {
          return { ok: false, error: String((caught && caught.message) || caught) }
        }
      }, [])

      const saveSettings = useCallback(async (patch) => {
        setSettingsBusy(true)
        setSettingsError(null)
        const result = await post('/settings', 'POST', patch || {})
        if (aliveRef.current) {
          if (!result.ok) setSettingsError(result.error)
          setSettingsBusy(false)
        }
        return result.ok
      }, [post])

      const saveKey = useCallback(async (value) => {
        setKeyBusy(true)
        setKeyError(null)
        setKeyNotice(null)
        const result = await post('/key', 'POST', { value })
        if (aliveRef.current) {
          if (!result.ok) setKeyError(result.error)
          else setKeyNotice('saved')
          setKeyBusy(false)
        }
        return result.ok
      }, [post])

      const clearKey = useCallback(async () => {
        setKeyBusy(true)
        setKeyError(null)
        setKeyNotice(null)
        const result = await post('/key', 'DELETE')
        if (aliveRef.current) {
          if (!result.ok) setKeyError(result.error)
          else setKeyNotice('cleared')
          setKeyBusy(false)
        }
        return result.ok
      }, [post])

      useEffect(() => {
        aliveRef.current = true
        load()
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load()
        }, 30_000)
        const onVisibility = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') load()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [load])

      return {
        state,
        error,
        refreshing,
        refresh,
        probing,
        probeError,
        probeNow,
        settingsBusy,
        settingsError,
        saveSettings,
        keyBusy,
        keyError,
        keyNotice,
        saveKey,
        clearKey,
      }
    }

    //#endregion

    //#region 持久化

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : fallback
      } catch {
        return fallback
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // 隐私模式或配额满：不持久化不影响使用
      }
    }

    function loadUi() {
      const saved = readJson(LS_UI, {})
      return {
        collapsed: saved.collapsed === true,
        tab: saved.tab === 'data' ? 'data' : saved.tab === 'settings' ? 'settings' : 'status',
        model: typeof saved.model === 'string' && saved.model ? saved.model : DEFAULT_MODEL,
      }
    }

    function loadPos() {
      const saved = readJson(LS_POS, null)
      if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null
      return { x: saved.x, y: saved.y }
    }

    //#endregion

    //#region 小组件

    function Lamp({ status, size }) {
      return h('span', {
        className: 'ocsw-lamp',
        'data-state': statusKey(status),
        style: size ? { width: size, height: size } : undefined,
        'aria-hidden': 'true',
      })
    }

    function Chip({ tone, children, title }) {
      return h('span', { className: 'ocsw-chip', 'data-tone': tone, title }, children)
    }

    function StatusChip({ status, t, reason }) {
      const tone = lampTone(status)
      const label = t(statusLabelKey(status))
      const why = reasonLabel(t, reason)
      return h(Chip, { tone, title: why ? `${label} · ${why}` : label }, why ? `${label}·${why}` : label)
    }

    function Sparkline({ probe, t }) {
      const samples = Array.isArray(probe?.samples) ? probe.samples : []
      const points = samples.filter((sample) => sample && sample.ok && Number.isFinite(sample.rtt)).slice(-40)
      if (points.length < 2) {
        return h('div', { className: 'ocsw-spark-empty' }, t('sampling'))
      }
      const width = 300
      const height = 34
      const pad = 3
      const values = points.map((sample) => sample.rtt)
      let min = Math.min(...values)
      let max = Math.max(...values)
      if (max - min < 40) max = min + 40
      const step = (width - pad * 2) / (points.length - 1)
      const yOf = (value) => height - pad - ((value - min) / (max - min)) * (height - pad * 2)
      const line = points
        .map((sample, index) => `${index === 0 ? 'M' : 'L'}${(pad + index * step).toFixed(1)},${yOf(sample.rtt).toFixed(2)}`)
        .join(' ')
      const area = `${line} L${width - pad},${height - pad} L${pad},${height - pad} Z`
      const last = points[points.length - 1]
      const lastX = pad + (points.length - 1) * step
      const lastY = yOf(last.rtt)
      const quality = probe?.quality || 'unknown'
      return h('div', { className: 'ocsw-spark' },
        h('svg', {
          className: 'ocsw-spark-svg',
          viewBox: `0 0 ${width} ${height}`,
          preserveAspectRatio: 'none',
          'aria-hidden': 'true',
        },
        h('path', { className: 'ocsw-spark-area', 'data-quality': quality, d: area }),
        h('line', { className: 'ocsw-spark-base', x1: pad, y1: height - pad, x2: width - pad, y2: height - pad }),
        h('path', { className: 'ocsw-spark-line', 'data-quality': quality, d: line }),
        ),
        h('span', {
          className: 'ocsw-spark-dot',
          'data-quality': quality,
          style: { left: `${(lastX / width) * 100}%`, top: `${(lastY / height) * 100}%` },
          'aria-hidden': 'true',
        }),
      )
    }

    function Countdown({ nextAt, intervalMs, t }) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 500)
        return () => clearInterval(timer)
      }, [])
      const remaining = Number.isFinite(nextAt) ? Math.max(0, nextAt - now) : 0
      const progress = nextAt && intervalMs ? clamp(1 - remaining / intervalMs, 0, 1) : 0
      const label = remaining > 0 ? t('nextIn', { s: Math.ceil(remaining / 1000) }) : t('dueNow')
      return h('div', { className: 'ocsw-countdown', title: label, 'aria-hidden': 'true' },
        h('span', { className: 'ocsw-countdown-fill', style: { width: `${progress * 100}%` } }),
      )
    }

    function SectionHead({ label, tag, right }) {
      return h('div', { className: 'ocsw-secrow' },
        h('span', { className: 'ocsw-lab' }, label, tag ? h('i', null, tag) : null),
        right,
      )
    }

    //#endregion

    //#region 状态页签

    function LineSection({ probe, meta, t }) {
      const quality = probe?.quality || 'unknown'
      const tone = qualityTone(quality)
      const rttUnit = Number.isFinite(probe?.lastRtt) && probe.lastRtt >= 1000 ? 's' : 'ms'
      const rttValue = Number.isFinite(probe?.lastRtt)
        ? (probe.lastRtt >= 1000 ? (probe.lastRtt / 1000).toFixed(2) : Math.round(probe.lastRtt))
        : null
      const metaBits = []
      if (Number.isFinite(probe?.avg)) metaBits.push(t('avg', { v: fmtMs(probe.avg) }))
      if (Number.isFinite(probe?.jitter)) metaBits.push(t('jitter', { v: `${probe.jitter}` }))
      if (Number.isFinite(probe?.successRate)) metaBits.push(t('success', { v: `${Math.round(probe.successRate * 100)}%` }))
      if (Number.isFinite(probe?.count) && probe.count > 0) metaBits.push(t('samples', { v: probe.count }))
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, {
          label: t('secLine'),
          tag: 'LINE',
          right: h(Chip, { tone }, t(qualityLabelKey(quality))),
        }),
        h('div', { className: 'ocsw-main', title: t('rttHint') },
          h('b', null, rttValue === null ? '—' : rttValue),
          rttValue === null ? null : h('span', null, rttUnit),
        ),
        h(Sparkline, { probe, t }),
        h('div', { className: 'ocsw-meta' }, metaBits.map((bit, index) => h('span', { key: index }, bit))),
        h(Countdown, { nextAt: meta?.nextStatusAt, intervalMs: meta?.statusIntervalMs, t }),
      )
    }

    function ServicesSection({ status, t }) {
      const plans = Array.isArray(status?.plans) ? status.plans : []
      const showOrder = ['console', 'inference', 'go', 'payg', 'free']
      const labelOf = (id) => {
        if (id === 'console') return t('planConsole')
        if (id === 'inference') return t('planInference')
        if (id === 'go') return t('planGo')
        if (id === 'payg') return t('planPayg')
        return t('planFree')
      }
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, { label: t('secServices'), tag: 'SERVICES' }),
        showOrder.length
          ? h('div', { className: 'ocsw-lamps' },
            showOrder.map((id) => {
              const plan = plans.find((item) => item.id === id)
              const why = plan ? reasonLabel(t, plan.reason) : ''
              const title = plan ? `${labelOf(id)} · ${t(statusLabelKey(plan.status))}${why ? ` · ${why}` : ''}` : labelOf(id)
              return h('span', { className: 'ocsw-lamp-item', key: id, title },
                h(Lamp, { status: plan ? plan.status : 'unknown' }),
                labelOf(id),
              )
            }),
          )
          : h('div', { className: 'ocsw-meta' }, t('servicesNone')),
      )
    }

    function translateProbeError(code, t) {
      if (code === 'probe-cooldown') return t('probeCooldown')
      if (code === 'probe-running') return t('probeRunning')
      return code
    }

    function ProbeSection({ liveProbe, catalog, model, officialTtft, t, onProbe, probing, probeError }) {
      const last = liveProbe && liveProbe.last ? liveProbe.last : null
      const configured = Boolean(liveProbe && liveProbe.key && liveProbe.key.configured)
      const enabled = Boolean(liveProbe && liveProbe.enabled)
      const tone = last ? probeTone(last) : (configured ? 'idle' : 'warn')
      const outcomeLabel = last
        ? t(probeOutcomeKey(last.outcome))
        : (configured ? t('probeWaiting') : t('probeUnconfigured'))
      const catalogModel = catalog && Array.isArray(catalog.models) && model
        ? catalog.models.find((item) => item.id === model.id) || null
        : null
      const factor = catalogModel && Number.isFinite(catalogModel.peakFactor) ? catalogModel.peakFactor : null
      const priceLine = catalogModel && Number.isFinite(catalogModel.inputPrice) && Number.isFinite(factor)
        ? `${t('probePrice', { v: `${fmtUsd(catalogModel.inputPrice * factor)} / ${fmtUsd(catalogModel.outputPrice * factor)}` })}${factor > 1 ? ` · ${t('probePeak', { f: factor })}` : ` · ${t('probeOffPeak')}`}`
        : null
      const today = liveProbe && liveProbe.today ? liveProbe.today : null
      const errorText = probeError ? translateProbeError(probeError, t) : ''
      const failureDetail = last && !last.ok
        ? `${t(probeOutcomeKey(last.outcome))}${last.httpStatus ? ` · HTTP ${last.httpStatus}` : ''}${last.message ? ` · ${last.message}` : ''}`
        : ''
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, {
          label: t('secProbe'),
          tag: 'PROBE',
          right: h(Chip, {
            tone,
            title: last && last.logId ? t('probeLog', { id: last.logId }) : outcomeLabel,
          }, outcomeLabel),
        }),
        last && last.ok
          ? h('div', { className: 'ocsw-metrics' },
            h('div', { className: 'ocsw-metric', title: t('probeTtft') },
              h('b', null, Number.isFinite(last.ttft) ? fmtSeconds(last.ttft) : '—', Number.isFinite(last.ttft) ? h('small', null, 's') : null),
              h('span', null, t('probeTtft')),
            ),
            h('div', { className: 'ocsw-metric', title: t('probeAllowance') },
              h('b', null, fmtTinyUsd(last.allowance)),
              h('span', null, t('probeAllowance')),
            ),
            h('div', { className: 'ocsw-metric', title: last.logId || '' },
              h('b', null, last.billingSource || '—'),
              h('span', null, t('probeBilling')),
            ),
          )
          : null,
        failureDetail
          ? h('div', { className: 'ocsw-meta', style: { marginBottom: 6, color: 'var(--dsw-alias-state-error-primary)' } }, failureDetail)
          : null,
        h('div', { className: 'ocsw-dataline' },
          Number.isFinite(officialTtft) ? h('span', null, t('probeOfficial', { v: fmtMs(officialTtft) })) : null,
          h('button', {
            className: 'ocsw-action',
            type: 'button',
            onClick: onProbe,
            disabled: probing,
            title: configured ? t('probeNow') : t('probeKeyHint', { ref: liveProbe && liveProbe.key ? liveProbe.key.ref : '' }),
          }, probing ? t('probeRunning') : t('probeNow')),
        ),
        priceLine ? h('div', { className: 'ocsw-meta', style: { marginTop: 6 } }, priceLine) : null,
        today && today.count > 0
          ? h('div', { className: 'ocsw-meta', style: { marginTop: 4 } }, t('probeToday', { n: today.count, v: fmtTinyUsd(today.allowanceUsd) }))
          : null,
        !configured && liveProbe
          ? h('div', { className: 'ocsw-meta', style: { marginTop: 4 } }, t('probeKeyHint', { ref: liveProbe.key ? liveProbe.key.ref : '' }))
          : null,
        !enabled && liveProbe
          ? h('div', { className: 'ocsw-meta', style: { marginTop: 4 } }, t('probeDisabled'))
          : null,
        h(Countdown, { nextAt: liveProbe && liveProbe.nextProbeAt, intervalMs: liveProbe && liveProbe.intervalMs, t }),
        errorText ? h('div', { className: 'ocsw-alert' }, errorText) : null,
      )
    }

    function UsageSection({ usage, t }) {
      const ready = Boolean(usage && usage.rolling && usage.weekly && usage.monthly)
      const meters = ready ? [usage.rolling, usage.weekly, usage.monthly] : []
      const limited = meters.some((meter) => meter.status === 'rate-limited')
      const chipTone = limited ? 'bad' : (ready ? 'ok' : (usage && usage.error ? 'warn' : 'idle'))
      const rows = [
        ['rolling', t('usageRolling')],
        ['weekly', t('usageWeekly')],
        ['monthly', t('usageMonthly')],
      ]
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, {
          label: t('secUsage'),
          tag: 'ALLOWANCE',
          right: h(Chip, { tone: chipTone }, limited ? t('usageLimited') : (ready ? t('usageOk') : t('usageUnavailable'))),
        }),
        ready
          ? h('div', { className: 'ocsw-usage' },
            rows.map(([key, label]) => {
              const meter = usage[key]
              const tone = usageTone(meter)
              return h('div', { className: 'ocsw-usage-row', key },
                h('span', { className: 'n' }, label),
                h('span', { className: 'b', 'data-tone': tone, 'aria-hidden': 'true' },
                  h('i', { style: { width: `${meter.percent}%` } })),
                h('span', { className: 'v', 'data-tone': tone }, `${Math.round(meter.percent)}%`),
                h('span', {
                  className: 'r',
                  title: Number.isFinite(meter.resetsAt) ? fmtTime(meter.resetsAt) : '',
                }, Number.isFinite(meter.resetsAt) ? t('usageResetIn', { v: fmtUntil(meter.resetsAt) }) : ''),
              )
            }),
          )
          : null,
        usage && usage.error
          ? h('div', {
            className: 'ocsw-meta',
            style: {
              marginTop: 6,
              color: usage.error.outcome === 'unconfigured' ? undefined : 'var(--dsw-alias-state-error-primary)',
            },
          }, usageErrorMessage(usage.error, t))
          : null,
        usage && usage.enabled === false
          ? h('div', { className: 'ocsw-meta', style: { marginTop: 4 } }, t('usageDisabled'))
          : null,
        usage && usage.at
          ? h('div', { className: 'ocsw-meta', style: { marginTop: 4 } }, t('usageUpdated', { time: fmtTime(usage.at) }))
          : null,
      )
    }

    function Switch({ checked, label, disabled, onChange }) {
      return h('button', {
        className: 'ocsw-switch',
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: label,
        disabled: Boolean(disabled),
        onClick: onChange,
      })
    }

    function SettingsPanel({ settings, t, saveSettings, settingsBusy, settingsError, saveKey, clearKey, keyBusy, keyError, keyNotice }) {
      const safe = settings || {}
      const limits = safe.limits || {}
      const probeMinSeconds = Number.isFinite(limits.probeMinSeconds) ? limits.probeMinSeconds : 120
      const probeMaxSeconds = Number.isFinite(limits.probeMaxSeconds) ? limits.probeMaxSeconds : 3600
      const usageMinSeconds = Number.isFinite(limits.usageMinSeconds) ? limits.usageMinSeconds : 60
      const usageMaxSeconds = Number.isFinite(limits.usageMaxSeconds) ? limits.usageMaxSeconds : 3600
      const toMinutes = (seconds, fallback) => (Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : fallback)
      const [probeMinutes, setProbeMinutes] = useState(() => toMinutes(safe.probeIntervalSeconds, 10))
      const [usageMinutes, setUsageMinutes] = useState(() => toMinutes(safe.usageIntervalSeconds, 2))
      const [keyDraft, setKeyDraft] = useState('')
      useEffect(() => {
        setProbeMinutes(toMinutes(safe.probeIntervalSeconds, 10))
      }, [safe.probeIntervalSeconds])
      useEffect(() => {
        setUsageMinutes(toMinutes(safe.usageIntervalSeconds, 2))
      }, [safe.usageIntervalSeconds])
      const probeEnabled = safe.probeEnabled !== false
      const usageEnabled = safe.usageEnabled !== false
      const key = safe.key || {}
      const activeLabel = key.dedicatedConfigured
        ? t('settingsKeyDedicated')
        : key.providerConfigured
          ? t('settingsKeyProvider', { ref: key.providerRef })
          : t('settingsKeyNone')
      const commitProbe = () => {
        const minutes = Math.round(Number(probeMinutes))
        if (!Number.isFinite(minutes)) {
          setProbeMinutes(toMinutes(safe.probeIntervalSeconds, 10))
          return
        }
        const seconds = Math.min(probeMaxSeconds, Math.max(probeMinSeconds, minutes * 60))
        setProbeMinutes(Math.round(seconds / 60))
        if (seconds !== safe.probeIntervalSeconds) saveSettings({ probeIntervalSeconds: seconds })
      }
      const commitUsage = () => {
        const minutes = Math.round(Number(usageMinutes))
        if (!Number.isFinite(minutes)) {
          setUsageMinutes(toMinutes(safe.usageIntervalSeconds, 2))
          return
        }
        const seconds = Math.min(usageMaxSeconds, Math.max(usageMinSeconds, minutes * 60))
        setUsageMinutes(Math.round(seconds / 60))
        if (seconds !== safe.usageIntervalSeconds) saveSettings({ usageIntervalSeconds: seconds })
      }
      const doSaveKey = async () => {
        const ok = await saveKey(keyDraft)
        if (ok) setKeyDraft('')
      }
      const intervalInput = (value, onChange, onCommit, enabled, min, max) => h('input', {
        className: 'ocsw-input',
        type: 'number',
        min,
        max,
        step: 1,
        value: String(value),
        disabled: !enabled,
        'aria-label': t('settingsInterval'),
        onChange: (event) => onChange(event.target.value),
        onBlur: onCommit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            onCommit()
            if (event.currentTarget && typeof event.currentTarget.blur === 'function') event.currentTarget.blur()
          }
        },
      })
      return h('div', { className: 'ocsw-settings' },
        h('div', { className: 'ocsw-set-row' },
          h('div', { className: 'ocsw-set-label' },
            h('span', null, t('settingsProbe')),
            h('small', null, t('settingsProbeHint')),
          ),
          h('div', { className: 'ocsw-set-control' },
            intervalInput(probeMinutes, setProbeMinutes, commitProbe, probeEnabled, Math.round(probeMinSeconds / 60), Math.round(probeMaxSeconds / 60)),
            h('span', { className: 'ocsw-unit' }, t('settingsMinutes')),
            h(Switch, {
              checked: probeEnabled,
              label: t('settingsProbe'),
              disabled: settingsBusy,
              onChange: () => saveSettings({ probeEnabled: !probeEnabled }),
            }),
          ),
        ),
        h('div', { className: 'ocsw-set-row' },
          h('div', { className: 'ocsw-set-label' },
            h('span', null, t('settingsUsage')),
            h('small', null, t('settingsUsageHint')),
          ),
          h('div', { className: 'ocsw-set-control' },
            intervalInput(usageMinutes, setUsageMinutes, commitUsage, usageEnabled, Math.round(usageMinSeconds / 60), Math.round(usageMaxSeconds / 60)),
            h('span', { className: 'ocsw-unit' }, t('settingsMinutes')),
            h(Switch, {
              checked: usageEnabled,
              label: t('settingsUsage'),
              disabled: settingsBusy,
              onChange: () => saveSettings({ usageEnabled: !usageEnabled }),
            }),
          ),
        ),
        h('div', { className: 'ocsw-set-sep', 'aria-hidden': 'true' }),
        h('div', { className: 'ocsw-set-row', style: { alignItems: 'flex-start' } },
          h('div', { className: 'ocsw-set-label' },
            h('span', null, t('settingsKey')),
            h('small', null, t('settingsKeyCurrent', { v: activeLabel })),
          ),
        ),
        h('div', { className: 'ocsw-keyline' },
          h('input', {
            className: 'ocsw-keyinput',
            type: 'password',
            value: keyDraft,
            placeholder: t('settingsKeyPlaceholder'),
            autoComplete: 'off',
            spellCheck: false,
            'aria-label': t('settingsKey'),
            onChange: (event) => setKeyDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') doSaveKey()
            },
          }),
          h('button', {
            className: 'ocsw-action',
            type: 'button',
            disabled: keyBusy || !keyDraft.trim(),
            onClick: doSaveKey,
          }, keyBusy ? t('settingsSaving') : t('settingsSave')),
          h('button', {
            className: 'ocsw-action',
            type: 'button',
            disabled: keyBusy || !key.dedicatedConfigured,
            onClick: () => clearKey(),
          }, t('settingsClear')),
        ),
        h('div', { className: 'ocsw-keyhint' }, t('settingsHint')),
        keyNotice ? h('div', { className: 'ocsw-notice' }, t(keyNotice === 'saved' ? 'settingsKeySaved' : 'settingsKeyCleared')) : null,
        keyError ? h('div', { className: 'ocsw-notice', 'data-tone': 'bad' }, t('settingsKeyError', { v: keyError })) : null,
        settingsError ? h('div', { className: 'ocsw-notice', 'data-tone': 'bad' }, t('settingsError', { v: settingsError })) : null,
      )
    }

    function GoSection({ model, profile, data, t, onOpenData }) {
      const ttft = model?.ttft
      const tps = model?.tps
      const tokensWeek = profile?.tokensWeek
      const rankWeek = profile?.rankWeek
      const tone = model ? lampTone(model.status) : 'idle'
      const change = fmtPctChange(profile?.changeWeek)
      const changeDir = Number.isFinite(profile?.changeWeek) ? (profile.changeWeek >= 0 ? 'up' : 'down') : undefined
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, { label: t('secGo'), tag: 'CHANNEL' }),
        h('div', { className: 'ocsw-metrics' },
          h('div', { className: 'ocsw-metric', 'data-tone': tone, title: t('ttftHint') },
            h('b', null, Number.isFinite(ttft) ? fmtSeconds(ttft) : '—', Number.isFinite(ttft) ? h('small', null, 's') : null),
            h('span', null, t('ttft')),
          ),
          h('div', { className: 'ocsw-metric', 'data-tone': tone, title: t('tpsHint') },
            h('b', null, Number.isFinite(tps) ? tps : '—'),
            h('span', null, t('tps')),
          ),
          h('div', { className: 'ocsw-metric', title: t('rankHint') },
            h('b', null, Number.isFinite(rankWeek) ? `#${rankWeek}` : '—'),
            h('span', null, t('rank7')),
          ),
        ),
        h('div', { className: 'ocsw-dataline' },
          Number.isFinite(tokensWeek) ? h('b', null, fmtTokens(tokensWeek)) : h('b', null, '—'),
          h('span', null, 'tokens · 7d'),
          change ? h('span', { 'data-dir': changeDir, style: { color: changeDir === 'up' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } }, change) : null,
          h('button', { className: 'ocsw-link', type: 'button', onClick: onOpenData, title: t('viewData') }, `${t('viewData')} →`),
        ),
        data ? null : h('div', { className: 'ocsw-meta', style: { marginTop: 6 } }, t('noData')),
      )
    }

    //#endregion

    //#region 数据页签

    function LedgerRow({ label, value, extra, extraDir }) {
      return h('div', { className: 'ocsw-row' },
        h('span', { className: 'k' }, label),
        h('span', { className: 'v' }, value),
        extra ? h('span', { className: 'x', 'data-dir': extraDir }, extra) : null,
      )
    }

    function LedgerSection({ model, profile, data, catalog, t }) {
      if (!data || !profile) {
        return h('div', { className: 'ocsw-sec' },
          h(SectionHead, { label: t('secLedger'), tag: 'LEDGER' }),
          h('div', { className: 'ocsw-loading' }, t('noData')),
        )
      }
      const rankWeek = profile.rankWeek
      const changeWeek = fmtPctChange(profile.changeWeek)
      const sessionCost = profile.sessionCostUsd
      const cachePercent = profile.cachedInputPercent
      const price = profile.pricePer1M
      const catalogModel = catalog && Array.isArray(catalog.models)
        ? catalog.models.find((item) => item.id === profile.model) || null
        : null
      const catalogFactor = catalogModel && Number.isFinite(catalogModel.peakFactor) ? catalogModel.peakFactor : null
      const livePrice = catalogModel && Number.isFinite(catalogModel.inputPrice) && Number.isFinite(catalogModel.outputPrice) && Number.isFinite(catalogFactor)
        ? `${fmtUsd(catalogModel.inputPrice * catalogFactor)} / ${fmtUsd(catalogModel.outputPrice * catalogFactor)}`
        : null
      const priceValue = livePrice || (price ? `${fmtUsd(price.input)} / ${fmtUsd(price.output)}` : '—')
      const priceExtra = livePrice
        ? (catalogFactor > 1 ? t('probePeak', { f: catalogFactor }) : t('probeOffPeak'))
        : (price ? t('priceMeta') : '')
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, {
          label: t('secLedger'),
          tag: 'LEDGER',
          right: h(Chip, { tone: 'idle' }, model?.name || profile.name || profile.model),
        }),
        h('div', { className: 'ocsw-rows' },
          h(LedgerRow, {
            label: t('tokensWeek'),
            value: Number.isFinite(profile.tokensWeek) ? `${fmtTokens(profile.tokensWeek)} tokens` : '—',
            extra: Number.isFinite(rankWeek) ? t('rankMeta', { n: rankWeek, change: changeWeek || '—' }) : changeWeek || '',
            extraDir: Number.isFinite(profile.changeWeek) ? (profile.changeWeek >= 0 ? 'up' : 'down') : undefined,
          }),
          h(LedgerRow, {
            label: t('tokensDay'),
            value: Number.isFinite(profile.tokensDay) ? `${fmtTokens(profile.tokensDay)} tokens` : '—',
            extra: Number.isFinite(profile.rankDay) ? `#${profile.rankDay}` : '',
          }),
          h(LedgerRow, {
            label: t('sessionCost'),
            value: fmtUsd(sessionCost),
            extra: Number.isFinite(profile.tokensPerSession) ? t('perSession', { v: fmtTokens(profile.tokensPerSession) }) : '',
          }),
          h('div', { className: 'ocsw-row' },
            h('span', { className: 'k' }, t('cacheHit')),
            h('span', { className: 'v' }, fmtPct(cachePercent)),
            h('span', { className: 'x' }, Number.isFinite(profile.cachedInputTokens) ? `${fmtTokens(profile.cachedInputTokens)} cached` : ''),
          ),
          Number.isFinite(cachePercent)
            ? h('div', { className: 'ocsw-bar', 'aria-hidden': 'true' },
              h('i', { style: { width: `${clamp(cachePercent, 0, 100)}%` } }))
            : null,
          h(LedgerRow, {
            label: t('price'),
            value: priceValue,
            extra: priceExtra,
          }),
          h(LedgerRow, {
            label: t('retention'),
            value: fmtPct(profile.retentionPercent),
            extra: Number.isFinite(profile.retentionRank) ? t('retentionRank', { n: profile.retentionRank }) : '',
          }),
        ),
      )
    }

    function RankSection({ data, t }) {
      if (!data || !Array.isArray(data.leaderboardWeek) || data.leaderboardWeek.length === 0) {
        return h('div', { className: 'ocsw-sec' },
          h(SectionHead, { label: t('secRank'), tag: 'TOP 5' }),
          h('div', { className: 'ocsw-loading' }, t('noData')),
        )
      }
      const rows = data.leaderboardWeek.slice(0, 5)
      const maxTokens = Math.max(...rows.map((row) => row.tokens || 0), 1)
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, {
          label: t('secRank'),
          tag: 'TOP 5',
          right: h('a', {
            className: 'ocsw-link',
            href: 'https://opencode.ai/zh/data',
            target: '_blank',
            rel: 'noreferrer',
            style: { textDecoration: 'none' },
          }, `${t('viewAll')} ↗`),
        }),
        h('div', { className: 'ocsw-leader' },
          rows.map((row) => {
            const change = fmtPctChange(row.changePercent)
            const dir = Number.isFinite(row.changePercent) ? (row.changePercent >= 0 ? 'up' : 'down') : undefined
            return h('div', {
              className: 'ocsw-lrow',
              key: row.model,
              style: { '--w': `${clamp((row.tokens || 0) / maxTokens * 100, 0, 100)}%` },
              title: `${row.name || row.model} · ${fmtTokens(row.tokens)} tokens`,
            },
            h('span', { className: 'r' }, row.rank ? `#${row.rank}` : '·'),
            h('span', { className: 'n' }, row.name || row.model),
            h('span', { className: 't' }, fmtTokens(row.tokens)),
            h('span', { className: 'd', 'data-dir': dir }, change || ''),
            )
          }),
        ),
      )
    }

    function ShareSection({ data, t }) {
      if (!data || !data.marketShare) {
        return h('div', { className: 'ocsw-sec' },
          h(SectionHead, { label: t('secShare'), tag: 'SHARE' }),
          h('div', { className: 'ocsw-loading' }, t('noData')),
        )
      }
      const labs = Array.isArray(data.marketShare.labs) ? data.marketShare.labs.slice(0, 4) : []
      const countries = Array.isArray(data.countries) ? data.countries.slice(0, 3) : []
      return h('div', { className: 'ocsw-sec' },
        h(SectionHead, {
          label: t('secShare'),
          tag: 'SHARE',
          right: h('span', { className: 'ocsw-meta' }, data.marketShare.date ? `${data.marketShare.date} · ${fmtTokens(data.marketShare.tokens)}` : ''),
        }),
        h('div', { className: 'ocsw-share' },
          labs.map((lab) => h('div', { className: 'ocsw-share-row', key: lab.lab },
            h('span', { className: 'n' }, lab.lab),
            h('span', { className: 'b', 'aria-hidden': 'true' }, h('i', { style: { width: `${clamp(lab.sharePercent || 0, 0, 100)}%` } })),
            h('span', { className: 'v' }, fmtPct(lab.sharePercent)),
          )),
        ),
        countries.length
          ? h('div', { className: 'ocsw-meta', style: { marginTop: 7 } },
            t('countries', { list: countries.map((row) => `${row.country} ${fmtPct(row.sharePercent)}`).join(' · ') }))
          : null,
      )
    }

    //#endregion

    //#region 主组件

    /**
     * 指针拖拽：把 `targetRef` 指向的元素拖到任意位置。
     * 用元素自身实测尺寸做夹取（展开卡片和小胶囊尺寸不同）；
     * `movedRef` 记录这一轮是否真的移动过，给胶囊的「点击展开」做抑制，
     * 免得拖完松手被当成一次点击又弹回展开态。
     */
    function useDraggable(setPos, targetRef) {
      const [dragging, setDragging] = useState(false)
      const dragRef = useRef(null)
      const movedRef = useRef(false)

      const onPointerDown = useCallback((event) => {
        if (event.button !== 0) return
        if (event.target && event.target.closest && event.target.closest('[data-nodrag]')) return
        const element = targetRef.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        dragRef.current = {
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          width: rect.width,
          height: rect.height,
          startX: event.clientX,
          startY: event.clientY,
        }
        movedRef.current = false
        setDragging(true)
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // 老浏览器没有指针捕获也不影响移动
        }
      }, [targetRef])

      const onPointerMove = useCallback((event) => {
        const drag = dragRef.current
        if (!drag) return
        if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) movedRef.current = true
        const x = clamp(event.clientX - drag.dx, 8, Math.max(8, window.innerWidth - drag.width - 8))
        const y = clamp(event.clientY - drag.dy, 8, Math.max(8, window.innerHeight - drag.height - 8))
        setPos({ x, y })
      }, [setPos])

      const onPointerUp = useCallback(() => {
        if (!dragRef.current) return
        dragRef.current = null
        setDragging(false)
      }, [])

      return {
        dragging,
        movedRef,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
      }
    }

    function App({ lang }) {
      const t = makeT(lang)
      const [ui, setUi] = useState(loadUi)
      const [pos, setPos] = useState(loadPos)
      const cardRef = useRef(null)
      const pillRef = useRef(null)
      const {
        state,
        error,
        refreshing,
        refresh,
        probing,
        probeError,
        probeNow,
        settingsBusy,
        settingsError,
        saveSettings,
        keyBusy,
        keyError,
        keyNotice,
        saveKey,
        clearKey,
      } = useHostState()
      const cardDrag = useDraggable(setPos, cardRef)
      const pillDrag = useDraggable(setPos, pillRef)

      useEffect(() => {
        writeJson(LS_UI, ui)
      }, [ui])

      useEffect(() => {
        if (pos) writeJson(LS_POS, pos)
      }, [pos])

      useEffect(() => {
        // 展开/收起会改变元素尺寸：沿用同一坐标时重新夹取，避免半边滑出视口。
        setPos((current) => {
          if (!current) return current
          const width = collapsed ? 190 : 304
          const height = collapsed ? 34 : 120
          const x = clamp(current.x, 8, Math.max(8, window.innerWidth - width - 8))
          const y = clamp(current.y, 8, Math.max(8, window.innerHeight - height - 8))
          return x === current.x && y === current.y ? current : { x, y }
        })
      }, [ui.collapsed, setPos])

      useEffect(() => {
        const onResize = () => {
          setPos((current) => {
            if (!current) return current
            return {
              x: clamp(current.x, 8, Math.max(8, window.innerWidth - 304 - 8)),
              y: clamp(current.y, 8, Math.max(8, window.innerHeight - 120)),
            }
          })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [setPos])

      const status = state && state.status ? state.status : null
      const data = state && state.data ? state.data : null
      const probe = (state && state.probe) || {}
      const meta = (state && state.meta) || {}
      const liveProbe = state && state.liveProbe ? state.liveProbe : null
      const catalog = state && state.goCatalog ? state.goCatalog : null
      const usage = state && state.usage ? state.usage : null
      const settings = state && state.settings ? state.settings : null
      const probeOn = !settings || settings.probeEnabled !== false
      const usageOn = !settings || settings.usageEnabled !== false
      const goPlan = status && Array.isArray(status.plans) ? status.plans.find((plan) => plan.id === 'go') : null
      const goModels = goPlan && Array.isArray(goPlan.models) && goPlan.models.length
        ? goPlan.models
        : GO_FALLBACK.map((id) => ({ id, status: 'unknown', ttft: null, tps: null, reason: 'none' }))
      const selectedId = goModels.some((model) => model.id === ui.model) ? ui.model : goModels[0] && goModels[0].id
      const selectedModel = goModels.find((model) => model.id === selectedId) || null
      const profile = selectedModel && data && data.modelProfiles ? data.modelProfiles[selectedModel.id] || null : null
      const modelName = (selectedModel && (MODEL_NAMES[selectedModel.id] || (profile && profile.name) || selectedModel.id)) || (profile && profile.name) || DEFAULT_MODEL

      const overall = status ? status.overall : 'unknown'
      const probeStatus = probeOn && liveProbe && liveProbe.last
        ? (liveProbe.last.ok ? 'operational' : (liveProbe.last.outcome === 'unconfigured' ? null : 'degraded'))
        : null
      // 胶囊灯取较差者，但「未配置 key」不拉低官方状态；额度用尽会拉低。
      const usageMeters = usageOn && usage && usage.rolling && usage.weekly && usage.monthly
        ? [usage.rolling, usage.weekly, usage.monthly]
        : []
      const usageLimited = usageMeters.some((meter) => meter.status === 'rate-limited')
      let pillStatus = probeStatus ? worstStatus(overall, probeStatus) : overall
      if (usageLimited) pillStatus = worstStatus(pillStatus, 'degraded')
      const updatedAt = status && Number.isFinite(status.updatedAt) ? status.updatedAt : null
      const stale = Boolean(status && status.stale)
      const lastError = probe.lastError || error || null
      const collapsed = ui.collapsed

      const anchorStyle = pos ? { left: pos.x, top: pos.y } : { right: 20, top: 72 }
      const moveUi = (patch) => setUi((current) => ({ ...current, ...patch }))

      if (collapsed) {
        const rttBrief = Number.isFinite(probe.lastRtt) ? fmtMs(probe.lastRtt) : '—'
        const ttftBrief = selectedModel && Number.isFinite(selectedModel.ttft) ? `${fmtSeconds(selectedModel.ttft)}s` : '—'
        return h('div', { className: 'ocsw-root', style: anchorStyle },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h('button', {
            className: 'ocsw-pill',
            type: 'button',
            ref: pillRef,
            ...pillDrag.handlers,
            onClick: () => {
              // 拖动松手也会派发 click：这一轮移动过就只当作拖动，不展开。
              if (pillDrag.movedRef.current) {
                pillDrag.movedRef.current = false
                return
              }
              moveUi({ collapsed: false })
            },
            title: t('expandHint'),
            'aria-label': `${t('title')} · ${t('expandHint')}`,
            style: pillDrag.dragging ? { cursor: 'grabbing' } : undefined,
          },
            h(Lamp, { status: pillStatus }),
            h('span', null, rttBrief),
            h('span', { className: 'sep', 'aria-hidden': 'true' }),
            h('span', { className: 'go' }, 'Go ', h('b', null, ttftBrief)),
          ),
        )
      }

      const showLoading = !state && !error

      return h('div', { className: 'ocsw-root', style: anchorStyle },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('section', {
          className: 'ocsw-card',
          ref: cardRef,
          role: 'region',
          'aria-label': t('title'),
          style: cardDrag.dragging ? { cursor: 'grabbing' } : undefined,
        },
          h('header', { className: 'ocsw-head', ...cardDrag.handlers, title: t('title') },
            h(Lamp, { status: overall }),
            h('div', { className: 'ocsw-title' }, 'OpenCode', h('i', null, t('title'))),
            h('div', { className: 'ocsw-toggles', 'data-nodrag': 'true' },
              h('button', {
                className: 'ocsw-chipbtn',
                type: 'button',
                'data-on': probeOn ? 'true' : 'false',
                'aria-pressed': probeOn ? 'true' : 'false',
                'aria-label': t('settingsProbe'),
                title: t('settingsProbeHint'),
                onClick: () => saveSettings({ probeEnabled: !probeOn }),
              },
              h('span', { className: 'dot', 'aria-hidden': 'true' }),
              t('toggleProbe'),
              ),
              h('button', {
                className: 'ocsw-chipbtn',
                type: 'button',
                'data-on': usageOn ? 'true' : 'false',
                'aria-pressed': usageOn ? 'true' : 'false',
                'aria-label': t('settingsUsage'),
                title: t('settingsUsageHint'),
                onClick: () => saveSettings({ usageEnabled: !usageOn }),
              },
              h('span', { className: 'dot', 'aria-hidden': 'true' }),
              t('toggleUsage'),
              ),
            ),
            h('div', { className: 'ocsw-actions', 'data-nodrag': 'true' },
              h('button', {
                className: 'ocsw-btn',
                type: 'button',
                onClick: refresh,
                title: t('refresh'),
                'aria-label': t('refresh'),
                'data-busy': refreshing ? 'true' : 'false',
              },
              h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
                h('path', {
                  d: 'M13.2 7.4a5.2 5.2 0 1 1-1.5-3.3M13.2 3.4v4h-4',
                  stroke: 'currentColor',
                  strokeWidth: 1.4,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
              )),
              h('button', {
                className: 'ocsw-btn',
                type: 'button',
                onClick: () => moveUi({ collapsed: true }),
                title: t('collapse'),
                'aria-label': t('collapse'),
              },
              h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
                h('path', {
                  d: 'M3.5 10 8 5.5 12.5 10',
                  stroke: 'currentColor',
                  strokeWidth: 1.4,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
              )),
            ),
          ),
          h('div', { className: 'ocsw-modelbar' },
            h('span', { className: 'tag' }, t('goLamp')),
            h('div', { className: 'ocsw-selectwrap' },
              h('select', {
                className: 'ocsw-select',
                value: selectedId || DEFAULT_MODEL,
                onChange: (event) => moveUi({ model: event.target.value }),
                title: t('selectModel'),
                'aria-label': t('selectModel'),
              },
              goModels.map((model) => h('option', { key: model.id, value: model.id },
                `${MODEL_NAMES[model.id] || model.id}`)),
              ),
            ),
            h(StatusChip, { status: selectedModel ? selectedModel.status : 'unknown', t, reason: selectedModel ? selectedModel.reason : 'none' }),
          ),
          h('nav', { className: 'ocsw-tabs', role: 'tablist' },
            h('button', {
              className: 'ocsw-tab',
              type: 'button',
              role: 'tab',
              'aria-selected': ui.tab === 'status' ? 'true' : 'false',
              onClick: () => moveUi({ tab: 'status' }),
            }, t('tabStatus')),
            h('button', {
              className: 'ocsw-tab',
              type: 'button',
              role: 'tab',
              'aria-selected': ui.tab === 'data' ? 'true' : 'false',
              onClick: () => moveUi({ tab: 'data' }),
            }, t('tabData')),
            h('button', {
              className: 'ocsw-tab',
              type: 'button',
              role: 'tab',
              'aria-selected': ui.tab === 'settings' ? 'true' : 'false',
              onClick: () => moveUi({ tab: 'settings' }),
            }, t('tabSettings')),
            h('span', { className: 'ocsw-tabs-model', title: modelName }, modelName),
          ),
          h('div', { className: 'ocsw-body' },
            lastError && !showLoading
              ? h('div', { className: 'ocsw-alert' }, `${t('errPrefix')}${lastError}`)
              : null,
            showLoading
              ? h('div', { className: 'ocsw-loading' }, t('loading'))
              : ui.tab === 'settings'
                ? h(SettingsPanel, {
                  settings,
                  t,
                  saveSettings,
                  settingsBusy,
                  settingsError,
                  saveKey,
                  clearKey,
                  keyBusy,
                  keyError,
                  keyNotice,
                })
                : ui.tab === 'data'
                ? [
                  h(LedgerSection, { key: 'ledger', model: selectedModel, profile, data, catalog, t }),
                  h(RankSection, { key: 'rank', data, t }),
                  h(ShareSection, { key: 'share', data, t }),
                ]
                : [
                  h(LineSection, { key: 'line', probe, meta, t }),
                  h(ServicesSection, { key: 'services', status, t }),
                  ...(probeOn ? [h(ProbeSection, {
                    key: 'probe',
                    liveProbe,
                    catalog,
                    model: selectedModel,
                    officialTtft: selectedModel ? selectedModel.ttft : null,
                    t,
                    onProbe: () => probeNow(selectedModel ? selectedModel.id : undefined),
                    probing,
                    probeError,
                  })] : []),
                  ...(usageOn ? [h(UsageSection, { key: 'usage', usage, t })] : []),
                  h(GoSection, {
                    key: 'go',
                    model: selectedModel,
                    profile,
                    data,
                    t,
                    onOpenData: () => moveUi({ tab: 'data' }),
                  }),
                ],
          ),
          h('footer', { className: 'ocsw-foot' },
            h('a', { href: 'https://opencode.ai/status/', target: '_blank', rel: 'noreferrer' }, `${t('statusPage')} ↗`),
            h('a', { href: 'https://opencode.ai/zh/data', target: '_blank', rel: 'noreferrer' }, `${t('dataPage')} ↗`),
            h('span', { className: 'time' },
              updatedAt ? t('updated', { time: fmtTime(updatedAt) }) : '',
              stale ? ` · ${t('stale')}` : '',
            ),
          ),
        ),
      )
    }

    //#endregion

    return {
      inject: ['slots'],
      apply(ctx) {
        const lang = detectLang(ctx)
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-opencode',
          order: 60,
        }, () => h(App, { lang })))
      },
    }
  },
})
