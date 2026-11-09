/**
 * OpenCode 线路仪表 · 宿主半边
 *
 * 做四件事：
 *   1. 定时轮询两个公开 JSON（频率克制：状态 60s、数据 300s，单线程不重叠）
 *   2. 测量本机到 opencode.ai 的往返时延，形成滑窗样本
 *   3. 可选的真实探针：用 Go 套餐凭据发一次极小的流式请求，测真实首字/计费来源/额度占用
 *   4. 在 DSH 自己的 HTTP 服务上挂 /dsh-opencode/api/*，给浏览器半边同源读取
 *
 * 凭据只在探针发起时经 DSH 凭据服务现取现用，绝不下发给浏览器、不写日志、不落盘；
 * 其余数据只在内存里缓存。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STATUS_URL = 'https://opencode.ai/status/api/status'
const DATA_URL = 'https://opencode.ai/data/index.json'
const GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models'
const GO_CHAT_URL = 'https://opencode.ai/inference/go/openai/v1/chat/completions'
const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
/** 仪表里可持久化、可在 UI 里改的运行设置；专用 key 存 DSH 凭据库，不进这个文件。 */
const PROBE_KEY_REF = 'DSH_OPENCODE_PROBE_KEY'
const SETTINGS_LIMITS = {
  probeIntervalSeconds: [120, 3600],
  usageIntervalSeconds: [60, 3600],
}
const ROUTE_PREFIX = '/dsh-opencode'
const USER_AGENT = 'dsh-opencode/0.1 (DSH web plugin; reads public status JSON)'
const PROBE_USER_AGENT = 'dsh-opencode/0.1 (DSH plugin live probe; reads status and probes Go plan)'
const PROBE_SESSION = `ocsw-${globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
  ? globalThis.crypto.randomUUID().slice(0, 8)
  : Math.random().toString(36).slice(2, 10)}`
const PROBE_MANUAL_COOLDOWN_MS = 30_000
const PROBE_KEY_RECHECK_MS = 5 * 60_000
const PROBE_BLOCKED_RETRY_MS = 30 * 60_000
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const PLANS = [
  { id: 'console', zh: '控制台', en: 'Console' },
  { id: 'logs', zh: '请求日志', en: 'Request logs' },
  { id: 'inference', zh: '推理 API', en: 'Inference API' },
  { id: 'go', zh: 'Go', en: 'Go' },
  { id: 'payg', zh: '按量', en: 'Pay-as-you-go' },
  { id: 'free', zh: '免费', en: 'Free' },
]

const DEFAULTS = {
  statusIntervalSeconds: 60,
  dataIntervalSeconds: 300,
  requestTimeoutSeconds: 15,
  probeSamples: 120,
  probeEnabled: true,
  probeIntervalSeconds: 600,
  probeKeyEnv: 'OPENCODE_GO_API_KEY',
  probeModel: 'deepseek-v4.1-flash',
  probeTimeoutSeconds: 30,
  goModelsIntervalSeconds: 1800,
  usageEnabled: true,
  usageIntervalSeconds: 120,
}

const MAX_BACKOFF_MS = 5 * 60_000

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const dataDir = process.env.OCSW_SETTINGS_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugin-data', 'dsh-opencode')
  const settingsPath = join(dataDir, 'settings.json')
  // UI 里保存的开关/间隔优先于 patch 默认值。
  applySavedSettings()
  const state = {
    status: null,
    data: null,
    samples: [],
    lastError: null,
    lastErrorAt: 0,
    lastStatusOkAt: 0,
    lastDataOkAt: 0,
    lastDataRtt: null,
    statusBytes: 0,
    dataBytes: 0,
  }

  const probe = {
    inFlight: false,
    last: null,
    history: [],
    nextAt: 0,
    cooldownUntil: 0,
    blocked: null,
    key: { configured: false, source: null, checkedAt: 0 },
    today: { day: '', count: 0, okCount: 0, allowanceUsd: 0, listCostUsd: 0 },
  }
  const catalog = { at: 0, models: [], failures: 0 }
  const usage = {
    inFlight: false,
    configured: null,
    data: null,
    at: 0,
    error: null,
    failures: 0,
    nextAt: 0,
  }

  let statusTimer = null
  let dataTimer = null
  let probeTimer = null
  let catalogTimer = null
  let usageTimer = null
  let statusBusy = false
  let dataBusy = false
  let statusFailures = 0
  let dataFailures = 0
  let nextStatusAt = 0
  let nextDataAt = 0
  let disposed = false

  const log = (line) => console.log(`[dsh-opencode] ${line}`)

  //#region 抓取

  /**
   * 一次 GET，返回解析后的 JSON 与本机测得的往返时延（到响应体读完为止）。
   * 超时、非 2xx、JSON 解析失败都抛出可读错误。
   */
  async function fetchJson(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000)
    const startedAt = Date.now()
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
      })
      const body = await response.text()
      const rtt = Date.now() - startedAt
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        error.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
        throw error
      }
      let json
      try {
        json = JSON.parse(body)
      } catch {
        throw new Error('响应不是 JSON')
      }
      return { json, rtt, bytes: body.length }
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(`请求超时（${config.requestTimeoutSeconds}s）`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  function parseRetryAfter(value) {
    if (!value) return 0
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS)
    const at = Date.parse(value)
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), MAX_BACKOFF_MS))
    return 0
  }

  //#endregion

  //#region 轮询调度

  function scheduleStatus(delayMs) {
    if (disposed) return
    clearTimeout(statusTimer)
    nextStatusAt = Date.now() + delayMs
    statusTimer = setTimeout(() => {
      pollStatus().catch((error) => log(`状态轮询异常：${error?.message || error}`))
    }, delayMs)
  }

  function scheduleData(delayMs) {
    if (disposed) return
    clearTimeout(dataTimer)
    nextDataAt = Date.now() + delayMs
    dataTimer = setTimeout(() => {
      pollData().catch((error) => log(`数据轮询异常：${error?.message || error}`))
    }, delayMs)
  }

  async function pollStatus() {
    if (disposed || statusBusy) return
    statusBusy = true
    try {
      const { json, rtt, bytes } = await fetchJson(STATUS_URL)
      state.status = normalizeStatus(json)
      state.statusBytes = bytes
      state.lastStatusOkAt = Date.now()
      state.lastError = null
      state.lastErrorAt = 0
      statusFailures = 0
      pushSample({ at: state.lastStatusOkAt, rtt, ok: true })
      scheduleStatus(config.statusIntervalSeconds * 1000)
    } catch (error) {
      statusFailures += 1
      state.lastError = String(error?.message || error)
      state.lastErrorAt = Date.now()
      pushSample({ at: state.lastErrorAt, rtt: null, ok: false })
      // 429 / 5xx / 网络错误都退避：30s 起，指数增长，封顶 5 分钟；尊重 Retry-After。
      const backoff = error?.retryAfterMs || Math.min(30_000 * 2 ** (statusFailures - 1), MAX_BACKOFF_MS)
      log(`状态抓取失败（第 ${statusFailures} 次）：${state.lastError}，${Math.round(backoff / 1000)}s 后重试`)
      scheduleStatus(backoff)
    } finally {
      statusBusy = false
    }
  }

  async function pollData() {
    if (disposed || dataBusy) return
    dataBusy = true
    try {
      const { json, rtt, bytes } = await fetchJson(DATA_URL)
      state.data = normalizeData(json)
      state.dataBytes = bytes
      state.lastDataOkAt = Date.now()
      state.lastDataRtt = rtt
      dataFailures = 0
      scheduleData(config.dataIntervalSeconds * 1000)
    } catch (error) {
      dataFailures += 1
      const backoff = error?.retryAfterMs || Math.min(60_000 * 2 ** (dataFailures - 1), MAX_BACKOFF_MS)
      log(`数据抓取失败（第 ${dataFailures} 次）：${error?.message || error}，${Math.round(backoff / 1000)}s 后重试`)
      scheduleData(backoff)
    } finally {
      dataBusy = false
    }
  }

  function pushSample(sample) {
    state.samples.push(sample)
    const keep = Math.max(20, config.probeSamples)
    if (state.samples.length > keep) state.samples.splice(0, state.samples.length - keep)
  }

  //#endregion

  //#region 真实探针（Go 套餐）

  const keyStatus = {
    dedicated: { configured: false, source: null, checkedAt: 0 },
    provider: { configured: false, source: null, checkedAt: 0 },
  }

  async function inspectProbeKey(ref) {
    try {
      const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : null
      if (credentials && typeof credentials.describe === 'function') {
        const info = await credentials.describe(ref)
        return { configured: Boolean(info && info.configured), source: (info && info.source) || null, checkedAt: Date.now(), ref }
      }
    } catch {
      // 凭据服务不在时退回环境变量
    }
    const fromEnv = typeof process !== 'undefined' && process.env ? process.env[ref] : undefined
    return { configured: Boolean(fromEnv), source: fromEnv ? 'env' : null, checkedAt: Date.now(), ref }
  }

  /** 依次尝试专用 key、provider key；返回实际用到的引用名，便于 UI 说明来源。 */
  async function resolveProbeKey(fallbackRef) {
    for (const ref of [PROBE_KEY_REF, fallbackRef]) {
      try {
        const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : null
        if (credentials && typeof credentials.resolve === 'function') {
          const hit = await credentials.resolve(ref)
          if (hit && typeof hit.value === 'string' && hit.value) {
            return { value: hit.value, source: hit.source || 'store', ref, dedicated: ref === PROBE_KEY_REF }
          }
        }
      } catch {
        // 继续尝试环境变量
      }
      const fromEnv = typeof process !== 'undefined' && process.env ? process.env[ref] : undefined
      if (typeof fromEnv === 'string' && fromEnv) return { value: fromEnv, source: 'env', ref, dedicated: ref === PROBE_KEY_REF }
    }
    return null
  }

  async function refreshKeyState() {
    const [dedicated, provider] = await Promise.all([
      inspectProbeKey(PROBE_KEY_REF),
      inspectProbeKey(config.probeKeyEnv),
    ])
    keyStatus.dedicated = dedicated
    keyStatus.provider = provider
    const active = dedicated.configured
      ? { ...dedicated, dedicated: true }
      : { ...provider, dedicated: false }
    probe.key = {
      configured: active.configured,
      source: active.source,
      checkedAt: Date.now(),
      ref: active.ref || (dedicated.configured ? PROBE_KEY_REF : config.probeKeyEnv),
      dedicated: active.dedicated,
    }
    return probe.key
  }

  function scheduleProbe(delayMs) {
    if (disposed) return
    clearTimeout(probeTimer)
    if (!config.probeEnabled) {
      probe.nextAt = 0
      return
    }
    probe.nextAt = Date.now() + delayMs
    probeTimer = setTimeout(() => {
      runProbe({ manual: false }).catch((error) => log(`探针异常：${error?.message || error}`))
    }, delayMs)
  }

  async function runProbe(options = {}) {
    const manual = options.manual === true
    if (probe.inFlight) return null
    if (!config.probeEnabled && !manual) return null
    if (!config.probeEnabled) {
      clearTimeout(probeTimer)
      probe.nextAt = 0
    }
    const requested = typeof options.model === 'string' && options.model ? options.model : config.probeModel
    const key = await resolveProbeKey(config.probeKeyEnv)
    if (!key) {
      probe.key = { configured: false, source: null, checkedAt: Date.now(), ref: null, dedicated: false }
      probe.last = {
        at: Date.now(),
        model: requested,
        ok: false,
        outcome: 'unconfigured',
        message: `未配置 ${PROBE_KEY_REF} 或 ${config.probeKeyEnv}`,
        manual,
      }
      probe.blocked = 'unconfigured'
      probe.nextAt = Date.now() + PROBE_KEY_RECHECK_MS
      probeTimer = setTimeout(() => {
        runProbe({ manual: false }).catch((error) => log(`探针异常：${error?.message || error}`))
      }, PROBE_KEY_RECHECK_MS)
      return probe.last
    }
    probe.key = { configured: true, source: key.source, checkedAt: Date.now(), ref: key.ref, dedicated: key.dedicated }
    probe.inFlight = true
    probe.blocked = null
    const startedAt = Date.now()
    let result
    try {
      result = await probeChat({ model: requested, key: key.value })
    } catch (error) {
      result = classifyProbeFailure(error, requested, Date.now() - startedAt)
    } finally {
      probe.inFlight = false
    }
    result.manual = manual
    result.at = Date.now()
    probe.last = result
    probe.history.push(slimProbeResult(result))
    if (probe.history.length > 40) probe.history.splice(0, probe.history.length - 40)
    recordProbeUsage(result)

    if (result.outcome === 'auth' || result.outcome === 'funds') {
      probe.blocked = result.outcome
      log(`实测被阻断：${result.outcome}${result.message ? ` · ${result.message}` : ''}`)
      scheduleProbe(PROBE_BLOCKED_RETRY_MS)
    } else if (config.probeEnabled) {
      const base = config.probeIntervalSeconds * 1000
      const delay = result.outcome === 'rate-limit'
        ? Math.max(base, toNumber(result.retryAfterMs) || base)
        : result.ok
          ? base
          : Math.min(base * 2, 60 * 60_000)
      scheduleProbe(delay)
    }
    return result
  }

  async function probeChat({ model, key }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.probeTimeoutSeconds * 1000)
    const startedAt = Date.now()
    try {
      const response = await fetch(GO_CHAT_URL, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          'user-agent': PROBE_USER_AGENT,
          'x-opencode-session': PROBE_SESSION,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say ok' }],
          max_tokens: 16,
          stream: true,
          stream_options: { include_usage: true },
        }),
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
      })
      const headersMs = Date.now() - startedAt
      const logId = response.headers.get('x-opencode-log-id')
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const failure = classifyProbeHttp(response.status, text)
        return {
          ok: false,
          outcome: failure.outcome,
          model,
          httpStatus: response.status,
          message: failure.message,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          headersMs,
          total: Date.now() - startedAt,
          logId,
        }
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let ttft = null
      let usage = null
      let events = 0
      const maxEvents = 400
      while (events < maxEvents) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          for (const line of block.split('\n')) {
            if (line.slice(0, 5) !== 'data:') continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            let event
            try {
              event = JSON.parse(payload)
            } catch {
              continue
            }
            events += 1
            if (!usage && event.usage) usage = event.usage
            if (ttft === null) {
              const choices = Array.isArray(event.choices) ? event.choices : []
              const hasDelta = choices.some((choice) => {
                const delta = choice && choice.delta
                return Boolean(delta && (delta.content || delta.reasoning_content))
              })
              if (hasDelta) ttft = Date.now() - startedAt
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
        if (ttft !== null && usage) break
      }
      try {
        await reader.cancel()
      } catch {
        // 已读完
      }
      const total = Date.now() - startedAt
      const opencode = usage && usage.opencode ? usage.opencode : {}
      return {
        ok: true,
        outcome: 'ok',
        model,
        httpStatus: response.status,
        ttft,
        headersMs,
        total,
        events,
        promptTokens: toNumber(usage && usage.prompt_tokens),
        completionTokens: toNumber(usage && usage.completion_tokens),
        reasoningTokens: toNumber(usage && usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens),
        cachedTokens: toNumber(usage && usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens),
        cost: toNumber(usage && usage.cost),
        allowance: toNumber(opencode.allowance),
        listCost: toNumber(opencode.list_cost),
        billingSource: typeof opencode.billing_source === 'string' ? opencode.billing_source : null,
        logId,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  function classifyProbeHttp(status, text) {
    const message = sanitizeProbeMessage(text)
    if (status === 401 || status === 403) return { outcome: 'auth', message: message || '密钥被拒绝' }
    if (status === 402) return { outcome: 'funds', message: message || '额度或余额不足' }
    if (status === 429) return { outcome: 'rate-limit', message: message || '触发限流' }
    if (status === 404) return { outcome: 'model', message: message || '模型不可用' }
    if (status >= 500) return { outcome: 'upstream', message: message || `上游 ${status}` }
    return { outcome: 'http', message: message || `HTTP ${status}` }
  }

  function classifyProbeFailure(error, model, elapsedMs) {
    const aborted = Boolean(error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return {
      ok: false,
      outcome: aborted ? 'timeout' : 'network',
      model,
      httpStatus: null,
      message: aborted ? `请求超时（${config.probeTimeoutSeconds}s）` : sanitizeProbeMessage(String((error && error.message) || error)),
      total: elapsedMs,
    }
  }

  function slimProbeResult(result) {
    return {
      at: result.at,
      ok: result.ok,
      outcome: result.outcome,
      ttft: toNumber(result.ttft),
      total: toNumber(result.total),
      allowance: toNumber(result.allowance),
      billingSource: result.billingSource || null,
    }
  }

  function recordProbeUsage(result) {
    const day = localDayKey(Date.now())
    if (probe.today.day !== day) probe.today = { day, count: 0, okCount: 0, allowanceUsd: 0, listCostUsd: 0 }
    probe.today.count += 1
    if (result.ok) probe.today.okCount += 1
    if (Number.isFinite(result.allowance)) probe.today.allowanceUsd += result.allowance
    if (Number.isFinite(result.listCost)) probe.today.listCostUsd += result.listCost
  }

  function buildProbeState() {
    const recent = probe.history.slice(-12)
    const okCount = recent.filter((item) => item.ok).length
    return {
      enabled: config.probeEnabled,
      key: {
        ref: probe.key.ref || config.probeKeyEnv,
        configured: probe.key.configured,
        source: probe.key.source,
        dedicated: Boolean(probe.key.dedicated),
        checkedAt: probe.key.checkedAt,
      },
      model: config.probeModel,
      intervalMs: config.probeIntervalSeconds * 1000,
      nextProbeAt: probe.nextAt || 0,
      cooldownUntil: probe.cooldownUntil || 0,
      inFlight: probe.inFlight,
      blocked: probe.blocked,
      last: probe.last,
      history: recent,
      successRate: recent.length ? okCount / recent.length : null,
      today: probe.today,
    }
  }

  //#endregion

  //#region Go 模型清单

  function scheduleCatalog(delayMs) {
    if (disposed) return
    clearTimeout(catalogTimer)
    catalogTimer = setTimeout(() => {
      fetchGoCatalog().catch((error) => log(`Go 清单抓取异常：${error?.message || error}`))
    }, delayMs)
  }

  async function fetchGoCatalog() {
    try {
      const { json } = await fetchJson(GO_MODELS_URL)
      const normalized = normalizeGoCatalog(json)
      if (normalized.length) {
        catalog.models = normalized
        catalog.at = Date.now()
        catalog.failures = 0
      }
      scheduleCatalog(config.goModelsIntervalSeconds * 1000)
    } catch (error) {
      catalog.failures += 1
      const backoff = Math.min(config.goModelsIntervalSeconds * 1000 * 2 ** catalog.failures, 6 * 60 * 60_000)
      log(`Go 清单抓取失败（第 ${catalog.failures} 次）：${error?.message || error}`)
      scheduleCatalog(backoff)
    }
  }

  function buildCatalogState() {
    if (!catalog.models.length) return null
    const now = Date.now()
    return {
      updatedAt: catalog.at,
      models: catalog.models.map((model) => ({
        id: model.id,
        name: model.name,
        family: model.family,
        protocols: model.protocols,
        context: model.context,
        outputLimit: model.outputLimit,
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        cachedPrice: model.cachedPrice,
        peakFactor: currentPriceFactor(model.multipliers, now),
        tools: model.tools,
        reasoning: model.reasoning,
      })),
    }
  }

  //#endregion

  //#region Go 额度（官方 usage 端点）

  function scheduleUsage(delayMs) {
    if (disposed) return
    clearTimeout(usageTimer)
    if (!config.usageEnabled) {
      usage.nextAt = 0
      return
    }
    usage.nextAt = Date.now() + delayMs
    usageTimer = setTimeout(() => {
      pollUsage().catch((error) => log(`额度查询异常：${error?.message || error}`))
    }, delayMs)
  }

  async function pollUsage() {
    if (disposed || usage.inFlight) return
    if (!config.usageEnabled) {
      usage.nextAt = 0
      return
    }
    usage.inFlight = true
    try {
      const key = await resolveProbeKey(config.probeKeyEnv)
      if (!key) {
        usage.configured = false
        usage.error = { outcome: 'unconfigured', message: `未配置 ${PROBE_KEY_REF} 或 ${config.probeKeyEnv}`, at: Date.now() }
        usage.nextAt = Date.now() + PROBE_KEY_RECHECK_MS
        clearTimeout(usageTimer)
        usageTimer = setTimeout(() => {
          pollUsage().catch((error) => log(`额度查询异常：${error?.message || error}`))
        }, PROBE_KEY_RECHECK_MS)
        return
      }
      usage.configured = true
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), Math.max(10, config.probeTimeoutSeconds) * 1000)
      const startedAt = Date.now()
      try {
        const response = await fetch(GO_USAGE_URL, {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${key.value}`,
            'user-agent': PROBE_USER_AGENT,
          },
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        })
        const text = await response.text()
        if (!response.ok) {
          const failure = classifyUsageHttp(response.status, text)
          usage.error = { outcome: failure.outcome, message: failure.message, at: Date.now() }
          usage.failures += 1
          const retry = failure.outcome === 'auth' || failure.outcome === 'forbidden'
            ? PROBE_BLOCKED_RETRY_MS
            : (parseRetryAfter(response.headers.get('retry-after'))
              || Math.min(config.usageIntervalSeconds * 1000 * 2 ** usage.failures, 30 * 60_000))
          log(`额度查询失败（第 ${usage.failures} 次）：${failure.outcome}${failure.message ? ` · ${failure.message}` : ''}`)
          scheduleUsage(retry)
          return
        }
        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          payload = null
        }
        const normalized = normalizeUsage(payload)
        if (!normalized) {
          usage.error = { outcome: 'schema', message: '额度响应格式不可识别', at: Date.now() }
          usage.failures += 1
          scheduleUsage(Math.min(config.usageIntervalSeconds * 1000 * 2 ** usage.failures, 30 * 60_000))
          return
        }
        usage.data = { ...normalized, rtt: Date.now() - startedAt }
        usage.at = Date.now()
        usage.error = null
        usage.failures = 0
        scheduleUsage(config.usageIntervalSeconds * 1000)
      } finally {
        clearTimeout(timeout)
      }
    } finally {
      usage.inFlight = false
    }
  }

  function classifyUsageHttp(status, text) {
    const message = sanitizeProbeMessage(text)
    if (status === 401) return { outcome: 'auth', message: message || '密钥被拒绝' }
    if (status === 403) return { outcome: 'forbidden', message: message || '该 key 没有 Go 订阅或不被工作区支持' }
    if (status === 429) return { outcome: 'rate-limit', message: message || '触发限流' }
    if (status >= 500) return { outcome: 'upstream', message: message || `上游 ${status}` }
    return { outcome: 'http', message: message || `HTTP ${status}` }
  }

  function buildUsageState() {
    return {
      enabled: config.usageEnabled,
      configured: usage.configured,
      keyRef: config.probeKeyEnv,
      intervalMs: config.usageIntervalSeconds * 1000,
      nextAt: usage.nextAt || 0,
      at: usage.at || 0,
      inFlight: usage.inFlight,
      error: usage.error,
      rolling: usage.data ? usage.data.rolling : null,
      weekly: usage.data ? usage.data.weekly : null,
      monthly: usage.data ? usage.data.monthly : null,
      rtt: usage.data ? usage.data.rtt : null,
    }
  }

  //#endregion

  //#region 运行设置（UI 开关 / 间隔 / 专用 key）

  function readSavedSettings() {
    try {
      const raw = readFileSync(settingsPath, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  function applySavedSettings() {
    const saved = readSavedSettings()
    if (!saved) return
    if (typeof saved.probeEnabled === 'boolean') config.probeEnabled = saved.probeEnabled
    if (typeof saved.usageEnabled === 'boolean') config.usageEnabled = saved.usageEnabled
    const probeSeconds = clampRange(saved.probeIntervalSeconds, SETTINGS_LIMITS.probeIntervalSeconds[0], SETTINGS_LIMITS.probeIntervalSeconds[1])
    if (probeSeconds !== null) config.probeIntervalSeconds = probeSeconds
    const usageSeconds = clampRange(saved.usageIntervalSeconds, SETTINGS_LIMITS.usageIntervalSeconds[0], SETTINGS_LIMITS.usageIntervalSeconds[1])
    if (usageSeconds !== null) config.usageIntervalSeconds = usageSeconds
  }

  function persistSettings() {
    try {
      mkdirSync(dataDir, { recursive: true })
      const payload = JSON.stringify({
        probeEnabled: config.probeEnabled,
        usageEnabled: config.usageEnabled,
        probeIntervalSeconds: config.probeIntervalSeconds,
        usageIntervalSeconds: config.usageIntervalSeconds,
        updatedAt: Date.now(),
      }, null, 2)
      const temp = `${settingsPath}.tmp`
      writeFileSync(temp, payload, { mode: 0o600 })
      renameSync(temp, settingsPath)
      return true
    } catch (error) {
      log(`运行设置保存失败：${error?.message || error}`)
      return false
    }
  }

  function buildSettingsState() {
    const dedicatedConfigured = Boolean(keyStatus.dedicated && keyStatus.dedicated.configured)
    const providerConfigured = Boolean(keyStatus.provider && keyStatus.provider.configured)
    return {
      probeEnabled: config.probeEnabled,
      usageEnabled: config.usageEnabled,
      probeIntervalSeconds: config.probeIntervalSeconds,
      usageIntervalSeconds: config.usageIntervalSeconds,
      key: {
        dedicatedRef: PROBE_KEY_REF,
        providerRef: config.probeKeyEnv,
        dedicatedConfigured,
        providerConfigured,
        activeRef: probe.key.ref || (dedicatedConfigured ? PROBE_KEY_REF : config.probeKeyEnv),
        activeConfigured: Boolean(probe.key.configured),
        dedicated: Boolean(probe.key.dedicated),
        source: probe.key.source || null,
      },
      limits: {
        probeMinSeconds: SETTINGS_LIMITS.probeIntervalSeconds[0],
        probeMaxSeconds: SETTINGS_LIMITS.probeIntervalSeconds[1],
        usageMinSeconds: SETTINGS_LIMITS.usageIntervalSeconds[0],
        usageMaxSeconds: SETTINGS_LIMITS.usageIntervalSeconds[1],
      },
    }
  }

  function rescheduleLive() {
    if (config.probeEnabled) scheduleProbe(1_500)
    else {
      clearTimeout(probeTimer)
      probe.nextAt = 0
    }
    if (config.usageEnabled) scheduleUsage(1_500)
    else {
      clearTimeout(usageTimer)
      usage.nextAt = 0
    }
  }

  function applySettingsPatch(patch) {
    const source = patch && typeof patch === 'object' ? patch : {}
    let changed = false
    if (typeof source.probeEnabled === 'boolean' && source.probeEnabled !== config.probeEnabled) {
      config.probeEnabled = source.probeEnabled
      changed = true
    }
    if (typeof source.usageEnabled === 'boolean' && source.usageEnabled !== config.usageEnabled) {
      config.usageEnabled = source.usageEnabled
      changed = true
    }
    if (source.probeIntervalSeconds !== undefined) {
      const next = clampRange(source.probeIntervalSeconds, SETTINGS_LIMITS.probeIntervalSeconds[0], SETTINGS_LIMITS.probeIntervalSeconds[1])
      if (next === null) return { error: 'bad-probe-interval' }
      if (next !== config.probeIntervalSeconds) {
        config.probeIntervalSeconds = next
        changed = true
      }
    }
    if (source.usageIntervalSeconds !== undefined) {
      const next = clampRange(source.usageIntervalSeconds, SETTINGS_LIMITS.usageIntervalSeconds[0], SETTINGS_LIMITS.usageIntervalSeconds[1])
      if (next === null) return { error: 'bad-usage-interval' }
      if (next !== config.usageIntervalSeconds) {
        config.usageIntervalSeconds = next
        changed = true
      }
    }
    if (!changed) return { changed: false }
    if (!persistSettings()) return { error: 'settings-not-saved' }
    rescheduleLive()
    return { changed: true }
  }

  //#endregion

  //#region 对外状态

  function publicState() {
    const probe = buildProbe(state.samples)
    return {
      ok: Boolean(state.status),
      serverNow: Date.now(),
      status: state.status,
      data: state.data,
      probe: {
        ...probe,
        samples: state.samples.slice(-60),
        lastError: state.lastError,
        lastErrorAt: state.lastErrorAt,
        lastStatusOkAt: state.lastStatusOkAt,
        lastDataOkAt: state.lastDataOkAt,
        lastDataRtt: state.lastDataRtt,
      },
      liveProbe: buildProbeState(),
      goCatalog: buildCatalogState(),
      usage: buildUsageState(),
      settings: buildSettingsState(),
      meta: {
        route: ROUTE_PREFIX,
        statusUrl: STATUS_URL,
        dataUrl: DATA_URL,
        statusPageUrl: 'https://opencode.ai/status/',
        dataPageUrl: 'https://opencode.ai/zh/data',
        statusIntervalMs: config.statusIntervalSeconds * 1000,
        dataIntervalMs: config.dataIntervalSeconds * 1000,
        nextStatusAt,
        nextDataAt,
        statusBytes: state.statusBytes,
        dataBytes: state.dataBytes,
      },
    }
  }

  //#endregion

  //#region 路由

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    try {
      if (path === '/api/state' && (req.method === 'GET' || req.method === 'HEAD')) {
        return sendJson(res, 200, publicState())
      }
      if (path === '/api/refresh' && req.method === 'POST') {
        await Promise.allSettled([pollStatus(), pollData(), pollUsage()])
        return sendJson(res, 200, publicState())
      }
      if (path === '/api/settings' && req.method === 'POST') {
        let body = {}
        try {
          body = await readJson(req)
        } catch {
          return sendJson(res, 400, { error: 'bad-json' })
        }
        const outcome = applySettingsPatch(body)
        if (outcome.error) return sendJson(res, 400, { error: outcome.error })
        return sendJson(res, 200, publicState())
      }
      if (path === '/api/key' && (req.method === 'POST' || req.method === 'DELETE')) {
        const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : null
        const writable = credentials && typeof credentials.set === 'function' && typeof credentials.unset === 'function'
        if (!writable) return sendJson(res, 503, { error: 'credentials-unavailable' })
        try {
          if (req.method === 'DELETE') {
            await credentials.unset(PROBE_KEY_REF)
          } else {
            let body = {}
            try {
              body = await readJson(req)
            } catch {
              return sendJson(res, 400, { error: 'bad-json' })
            }
            const value = typeof body.value === 'string' ? body.value.trim() : ''
            if (!value || value.length < 8 || value.length > 256 || /\s/.test(value)) {
              return sendJson(res, 400, { error: 'bad-key' })
            }
            await credentials.set(PROBE_KEY_REF, value)
          }
        } catch (error) {
          return sendJson(res, 500, {
            error: 'key-write-failed',
            message: sanitizeProbeMessage(String((error && error.message) || error)),
          })
        }
        await refreshKeyState()
        rescheduleLive()
        return sendJson(res, 200, publicState())
      }
      if (path === '/api/probe' && req.method === 'POST') {
        let body = {}
        try {
          body = await readJson(req)
        } catch {
          return sendJson(res, 400, { error: 'bad-json' })
        }
        if (probe.inFlight) return sendJson(res, 409, { error: 'probe-running' })
        const now = Date.now()
        if (now < probe.cooldownUntil) {
          return sendJson(res, 429, { error: 'probe-cooldown', retryInMs: probe.cooldownUntil - now })
        }
        probe.cooldownUntil = now + PROBE_MANUAL_COOLDOWN_MS
        const requested = typeof body.model === 'string' && body.model ? body.model : config.probeModel
        await runProbe({ manual: true, model: requested })
        return sendJson(res, 200, publicState())
      }
      return sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      return sendJson(res, 500, { error: String(error?.message || error) })
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const unregister = webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
      log(`路由就绪 ${ROUTE_PREFIX}/api/state`)
      return () => {
        try {
          unregister()
        } catch {
          // 宿主已拆除
        }
      }
    }, 'dsh-opencode: host route')
  })

  // 首次抓取错开 2s，避免和启动瞬间的其它请求挤在一起。
  scheduleStatus(2_000)
  scheduleData(4_000)
  // 实测探针与 Go 清单再错开一点；凭据状态只读，不产生网络请求。
  refreshKeyState().catch(() => {})
  scheduleCatalog(6_000)
  if (config.probeEnabled) scheduleProbe(9_000)
  if (config.usageEnabled) scheduleUsage(12_000)

  ctx.effect(() => () => {
    disposed = true
    clearTimeout(statusTimer)
    clearTimeout(dataTimer)
    clearTimeout(probeTimer)
    clearTimeout(catalogTimer)
    clearTimeout(usageTimer)
  }, 'dsh-opencode: pollers')
}

//#region 数据整形

function normalizeConfig(raw) {
  const pick = (value, fallback, min, max) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.min(max, Math.max(min, Math.round(number)))
  }
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    statusIntervalSeconds: pick(source.statusIntervalSeconds, DEFAULTS.statusIntervalSeconds, 20, 600),
    dataIntervalSeconds: pick(source.dataIntervalSeconds, DEFAULTS.dataIntervalSeconds, 60, 3600),
    requestTimeoutSeconds: pick(source.requestTimeoutSeconds, DEFAULTS.requestTimeoutSeconds, 5, 60),
    probeSamples: pick(source.probeSamples, DEFAULTS.probeSamples, 20, 500),
    probeEnabled: source.probeEnabled !== false,
    probeIntervalSeconds: pick(source.probeIntervalSeconds, DEFAULTS.probeIntervalSeconds, 120, 3600),
    probeKeyEnv: normalizeKeyRef(source.probeKeyEnv),
    probeModel: typeof source.probeModel === 'string' && source.probeModel.trim()
      ? source.probeModel.trim()
      : DEFAULTS.probeModel,
    probeTimeoutSeconds: pick(source.probeTimeoutSeconds, DEFAULTS.probeTimeoutSeconds, 5, 60),
    goModelsIntervalSeconds: pick(source.goModelsIntervalSeconds, DEFAULTS.goModelsIntervalSeconds, 600, 7200),
    usageEnabled: source.usageEnabled !== false,
    usageIntervalSeconds: pick(source.usageIntervalSeconds, DEFAULTS.usageIntervalSeconds, 60, 3600),
  }
}

/** 凭据引用必须是 POSIX 变量名形状；不合法时回退默认引用，避免拼写错误变成静默失效。 */
function normalizeKeyRef(value) {
  const ref = typeof value === 'string' ? value.trim() : ''
  return /^[A-Z][A-Z0-9_]*$/.test(ref) ? ref : DEFAULTS.probeKeyEnv
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeStatus(raw) {
  const components = asArray(raw?.components)
  const byId = new Map(components.map((component) => [component?.service, component]))
  const plans = PLANS.map((plan) => {
    const component = byId.get(plan.id) || {}
    return {
      id: plan.id,
      zh: plan.zh,
      en: plan.en,
      status: component.status || 'unknown',
      reason: component.reason || 'none',
      since: toNumber(component.since),
      speed: {
        ttft: toNumber(component.speed?.ttft),
        tps: toNumber(component.speed?.tps),
      },
      models: asArray(component.breakdown).map((model) => ({
        id: String(model?.id || ''),
        status: model?.status || 'unknown',
        reason: model?.reason || 'none',
        ttft: toNumber(model?.speed?.ttft),
        tps: toNumber(model?.speed?.tps),
      })).filter((model) => model.id),
    }
  })
  const go = plans.find((plan) => plan.id === 'go')
  return {
    overall: raw?.status || 'unknown',
    reason: raw?.reason || 'none',
    updatedAt: toNumber(raw?.updatedAt),
    since: toNumber(raw?.since),
    stale: Boolean(raw?.stale),
    plans,
    goModels: go ? go.models : [],
  }
}

function normalizeData(raw) {
  const leaderboard = raw?.leaderboard || {}
  const weekRows = asArray(leaderboard.pastWeek)
  const dayRows = asArray(leaderboard.pastDay)
  const profiles = new Map()

  const profileOf = (modelId) => {
    const id = String(modelId || '')
    if (!id) return null
    let profile = profiles.get(id)
    if (!profile) {
      profile = { model: id, name: id }
      profiles.set(id, profile)
    }
    return profile
  }

  for (const row of weekRows) {
    const profile = profileOf(row?.model)
    if (!profile) continue
    profile.name = row.name || profile.name
    profile.lab = row.lab || profile.lab
    profile.page = row.page || profile.page
    profile.rankWeek = toNumber(row.rank)
    profile.tokensWeek = toNumber(row.tokens)
    profile.changeWeek = toNumber(row.changePercent)
  }
  for (const row of dayRows) {
    const profile = profileOf(row?.model)
    if (!profile) continue
    profile.rankDay = toNumber(row.rank)
    profile.tokensDay = toNumber(row.tokens)
    profile.changeDay = toNumber(row.changePercent)
  }
  for (const row of asArray(raw?.sessionCost)) {
    const profile = profileOf(row?.model)
    if (!profile) continue
    profile.sessionCostUsd = toNumber(row.costPerSessionUsd)
    profile.tokensPerSession = toNumber(row.tokensPerSession)
  }
  for (const row of asArray(raw?.tokenPricesUsdPer1M)) {
    const profile = profileOf(row?.model)
    if (!profile) continue
    profile.pricePer1M = {
      input: toNumber(row.input),
      output: toNumber(row.output),
      cachedInput: toNumber(row.cachedInput),
    }
  }
  for (const row of asArray(raw?.cacheRatio)) {
    const profile = profileOf(row?.model)
    if (!profile) continue
    profile.cachedInputPercent = toNumber(row.cachedInputPercent)
    profile.cachedInputTokens = toNumber(row.cachedInputTokens)
  }
  for (const row of asArray(raw?.weeklyRetention)) {
    const profile = profileOf(row?.model)
    if (!profile) continue
    profile.retentionPercent = toNumber(row.retentionPercent)
    profile.retentionRank = toNumber(row.rank)
  }

  const marketShare = asArray(raw?.marketShare)
  const latestShare = marketShare[marketShare.length - 1] || null
  const labs = asArray(latestShare?.labs)
    .map((lab) => ({
      lab: String(lab?.lab || ''),
      tokens: toNumber(lab.tokens),
      sharePercent: toNumber(lab.sharePercent),
    }))
    .filter((lab) => lab.lab && lab.sharePercent !== null)
    .sort((a, b) => b.sharePercent - a.sharePercent)
    .slice(0, 8)

  return {
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    leaderboardWeek: weekRows.slice(0, 12).map((row) => ({
      rank: toNumber(row.rank),
      model: String(row.model || ''),
      name: row.name || row.model,
      lab: row.lab || '',
      tokens: toNumber(row.tokens),
      changePercent: toNumber(row.changePercent),
    })),
    leaderboardDay: dayRows.slice(0, 6).map((row) => ({
      rank: toNumber(row.rank),
      model: String(row.model || ''),
      name: row.name || row.model,
      tokens: toNumber(row.tokens),
    })),
    sessionCost: asArray(raw?.sessionCost).map((row) => ({
      model: String(row.model || ''),
      costPerSessionUsd: toNumber(row.costPerSessionUsd),
      tokensPerSession: toNumber(row.tokensPerSession),
    })),
    tokenPrices: asArray(raw?.tokenPricesUsdPer1M).map((row) => ({
      model: String(row.model || ''),
      input: toNumber(row.input),
      output: toNumber(row.output),
      cachedInput: toNumber(row.cachedInput),
    })),
    cacheRatio: asArray(raw?.cacheRatio).slice(0, 10).map((row) => ({
      model: String(row.model || ''),
      cachedInputPercent: toNumber(row.cachedInputPercent),
      cachedInputTokens: toNumber(row.cachedInputTokens),
    })),
    weeklyRetention: asArray(raw?.weeklyRetention).slice(0, 10).map((row) => ({
      rank: toNumber(row.rank),
      model: String(row.model || ''),
      name: row.name || row.model,
      retentionPercent: toNumber(row.retentionPercent),
    })),
    marketShare: latestShare
      ? { date: latestShare.date || null, tokens: toNumber(latestShare.tokens), labs }
      : null,
    countries: asArray(raw?.countries).slice(0, 8).map((row) => ({
      rank: toNumber(row.rank),
      country: String(row.country || ''),
      sharePercent: toNumber(row.sharePercent),
    })),
    modelProfiles: Object.fromEntries(profiles),
  }
}

//#endregion

//#region 本地网络质量

function buildProbe(samples) {
  const total = samples.length
  const ok = samples.filter((sample) => sample.ok && Number.isFinite(sample.rtt))
  const rtts = ok.map((sample) => sample.rtt)
  const recent = rtts.slice(-20)
  const avg = recent.length ? Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length) : null
  const min = rtts.length ? Math.min(...rtts) : null
  const max = rtts.length ? Math.max(...rtts) : null
  let jitter = null
  if (recent.length >= 2) {
    const mean = recent.reduce((sum, value) => sum + value, 0) / recent.length
    const variance = recent.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recent.length
    jitter = Math.round(Math.sqrt(variance))
  }

  let consecutiveFailures = 0
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].ok) break
    consecutiveFailures += 1
  }

  const successRate = total ? ok.length / total : null
  const lastRtt = rtts.length ? rtts[rtts.length - 1] : null

  let quality = 'unknown'
  if (total > 0) {
    if (consecutiveFailures >= 3) quality = 'down'
    else if (successRate !== null && successRate < 0.9) quality = 'unstable'
    else if (avg !== null) {
      if (avg <= 300) quality = 'fast'
      else if (avg <= 800) quality = 'good'
      else if (avg <= 1500) quality = 'fair'
      else quality = 'poor'
    }
  }

  return {
    count: total,
    okCount: ok.length,
    successRate,
    avg,
    min,
    max,
    jitter,
    lastRtt,
    consecutiveFailures,
    quality,
  }
}

//#endregion

function clampRange(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(max, Math.max(min, Math.round(number)))
}

//#region Go 额度的整形

/** 官方 usage 响应：{ usage: { rolling, weekly, monthly: { status, percent, resetsAt } } }。 */
function normalizeUsage(raw) {
  const container = raw && raw.usage
  if (!container || typeof container !== 'object') return null
  const windows = {}
  for (const key of ['rolling', 'weekly', 'monthly']) {
    const meter = container[key]
    if (!meter || typeof meter !== 'object') return null
    const percent = toNumber(meter.percent)
    if (percent === null) return null
    const reset = typeof meter.resetsAt === 'string' ? Date.parse(meter.resetsAt) : toNumber(meter.resetsAt)
    windows[key] = {
      status: typeof meter.status === 'string' ? meter.status : 'unknown',
      percent: Math.min(100, Math.max(0, percent)),
      resetsAt: Number.isFinite(reset) ? reset : null,
    }
  }
  return windows
}

//#endregion

//#region 探针与 Go 清单的整形/判定

/** Go 模型清单：只保留仪表要用的字段。 */
function normalizeGoCatalog(raw) {
  const models = []
  for (const entry of asArray(raw && raw.data)) {
    const id = String((entry && entry.id) || '')
    if (!id) continue
    const api = entry.api && typeof entry.api === 'object' ? entry.api : {}
    const price = (entry.cost && entry.cost.text) || {}
    models.push({
      id,
      name: entry.name || id,
      family: entry.family || null,
      protocols: Object.keys(api),
      context: toNumber(entry.limit && entry.limit.context),
      outputLimit: toNumber(entry.limit && entry.limit.output),
      inputPrice: toNumber(price.input && price.input.price),
      outputPrice: toNumber(price.output && price.output.price),
      cachedPrice: toNumber(price.input && price.input.cache && price.input.cache.read),
      multipliers: asArray(price.multipliers).filter((rule) => rule && typeof rule === 'object'),
      tools: Boolean(entry.capabilities && entry.capabilities.tools && entry.capabilities.tools.supported),
      reasoning: Boolean(entry.capabilities && entry.capabilities.reasoning && entry.capabilities.reasoning.supported),
    })
  }
  return models
}

/** 当前时段的峰值倍率（例如 DeepSeek V4.1 Flash 工作日 UTC 01–04 / 06–10 为 ×2）。 */
function currentPriceFactor(multipliers, now) {
  if (!Array.isArray(multipliers) || !multipliers.length) return 1
  const date = new Date(now)
  const values = {
    utc_days: WEEKDAYS[date.getUTCDay()] || '',
    utc_hours: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
    utc_months: pad2(date.getUTCMonth() + 1),
  }
  let factor = 1
  for (const rule of multipliers) {
    if (!rule || typeof rule !== 'object') continue
    if (!matchesWhenClause(rule.when, values)) continue
    const value = Number(rule.factor)
    if (Number.isFinite(value) && value > factor) factor = value
  }
  return factor
}

/** 支持的匹配子句：all / any / {字段:{in|gte|gt|lt|lte}}，字段暂时只认 utc_days / utc_hours / utc_months。 */
function matchesWhenClause(clause, values) {
  if (Array.isArray(clause)) return clause.every((item) => matchesWhenClause(item, values))
  if (!clause || typeof clause !== 'object') return false
  if (Array.isArray(clause.all)) return clause.all.every((item) => matchesWhenClause(item, values))
  if (Array.isArray(clause.any)) return clause.any.some((item) => matchesWhenClause(item, values))
  let seen = false
  for (const key of Object.keys(clause)) {
    if (!(key in values)) continue
    const condition = clause[key]
    if (!condition || typeof condition !== 'object') return false
    const value = values[key]
    if (Array.isArray(condition.in)) {
      if (!condition.in.map(String).includes(String(value))) return false
    } else {
      if (condition.gte !== undefined && !(value >= String(condition.gte))) return false
      if (condition.gt !== undefined && !(value > String(condition.gt))) return false
      if (condition.lt !== undefined && !(value < String(condition.lt))) return false
      if (condition.lte !== undefined && !(value <= String(condition.lte))) return false
    }
    seen = true
  }
  return seen
}

/** 错误体可能是 JSON 也可能是 HTML：取人类可读的一小段，去掉控制字符。 */
function sanitizeProbeMessage(text) {
  const raw = typeof text === 'string' ? text : ''
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const message = (parsed && parsed.error && parsed.error.message) || (parsed && parsed.message) || ''
    if (message) return String(message).replace(/[\u0000-\u001f]/g, ' ').slice(0, 200)
  } catch {
    // 非 JSON 错误体
  }
  return raw.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200)
}

function localDayKey(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

//#endregion

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}
