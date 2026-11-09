/**
 * 宿主半边的离线冒烟：用假的 cordis ctx 跑 apply，捕获 /dsh-opencode 路由，
 * 等首次轮询落库后直接调用 handler，检查整形结果。
 *
 * 探针验证：
 *   - 不配凭据 → 应得到 outcome=unconfigured，且不发任何推理请求
 *   - 设置 OCSW_TEST_KEY（读自 /tmp/ocsw-key）→ 走一次真实 Go 探针，验证字段
 *     （这会消耗约 $0.00001 的 Go 额度；只在手动跑这个脚本时发生）
 * 只在开发时用，不属于插件包。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

// 隔离设置文件，别写进真实的 ~/.dsh/plugin-data
const settingsDir = mkdtempSync(join(tmpdir(), 'ocsw-smoke-'))
process.env.OCSW_SETTINGS_DIR = settingsDir

const testKey = process.env.OCSW_TEST_KEY || ''

const routes = []
const disposers = []
const secretStore = new Map()
if (testKey) secretStore.set('OPENCODE_GO_API_KEY', testKey)

const fakeCredentials = {
  describe: async (ref) => ({
    configured: secretStore.has(ref),
    source: secretStore.has(ref) ? 'store' : null,
    writable: true,
  }),
  resolve: async (ref) => (secretStore.has(ref) ? { value: secretStore.get(ref), source: 'store' } : undefined),
  set: async (ref, value) => {
    secretStore.set(ref, value)
  },
  unset: async (ref) => {
    secretStore.delete(ref)
  },
}

function makeCtx() {
  const effect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  return {
    get(name) {
      if (name === 'credentials') return fakeCredentials
      return undefined
    },
    inject: (deps, callback) => {
      const webCtx = {
        effect,
        webServer: {
          register: (route) => {
            routes.push(route)
            return () => {}
          },
        },
      }
      callback(webCtx)
    },
    effect,
  }
}

function callHandler(route, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const listeners = { data: [], end: [], error: [] }
    const req = {
      url: path,
      method,
      headers: {},
      on(event, callback) {
        if (listeners[event]) listeners[event].push(callback)
      },
    }
    const chunks = []
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(code, headers) {
        this.statusCode = code
        this.headers = headers
      },
      end(payload) {
        chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || '')))
        resolve({ status: this.statusCode, headers: this.headers, text: Buffer.concat(chunks).toString('utf8') })
      },
    }
    try {
      route.handler(req, res)
    } catch (error) {
      reject(error)
      return
    }
    setImmediate(() => {
      if (body !== null) {
        const buffer = Buffer.from(JSON.stringify(body))
        for (const callback of listeners.data) callback(buffer)
      }
      for (const callback of listeners.end) callback()
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

apply(makeCtx(), {
  statusIntervalSeconds: 60,
  dataIntervalSeconds: 300,
  probeEnabled: true,
  probeIntervalSeconds: 120,
  goModelsIntervalSeconds: 1800,
})
console.log('routes:', routes.map((route) => `${route.kind}:${route.path}`))
console.log('real probe key available:', Boolean(testKey))

const deadline = Date.now() + 45_000
let payload = null
let shot = null
while (Date.now() < deadline) {
  await sleep(1000)
  const response = await callHandler(routes[0], '/dsh-opencode/api/state')
  if (response.status !== 200) continue
  shot = response.text
  payload = JSON.parse(shot)
  const probeSettled = payload.liveProbe && payload.liveProbe.last && !payload.liveProbe.inFlight
  const usageSettled = payload.usage && (payload.usage.at > 0 || Boolean(payload.usage.error))
  if (payload.status && payload.data && payload.goCatalog && probeSettled && usageSettled && payload.settings) break
}

function check(label, value) {
  const ok = Boolean(value)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) process.exitCode = 1
}

if (!payload) {
  console.error('no payload')
  process.exit(1)
}

check('status overall', payload.status && payload.status.overall)
check('six services', payload.status && payload.status.plans.length === 6)
check('go models > 0', payload.status && payload.status.goModels.length > 0)
const flash = payload.status.goModels.find((model) => model.id === 'deepseek-v4.1-flash')
check('go has deepseek-v4.1-flash', flash)
check('flash ttft number', flash && Number.isFinite(flash.ttft))
check('data modelProfiles', payload.data && payload.data.modelProfiles['deepseek-v4.1-flash'])
check('link probe samples', payload.probe.samples.length > 0)
check('link probe quality', payload.probe.quality)
check('nextStatusAt', payload.meta.nextStatusAt > Date.now() - 120_000)

// —— Go 清单 ——
check('go catalog present', payload.goCatalog && payload.goCatalog.models.length >= 20)
const catalogFlash = payload.goCatalog && payload.goCatalog.models.find((model) => model.id === 'deepseek-v4.1-flash')
check('go catalog has flash', catalogFlash)
check('flash peak factor in {1,2}', catalogFlash && [1, 2].includes(catalogFlash.peakFactor))
check('flash price present', catalogFlash && Number.isFinite(catalogFlash.inputPrice))

// —— Go 额度 ——
check('usage present', Boolean(payload.usage))
check('usage key ref', payload.usage && payload.usage.keyRef === 'OPENCODE_GO_API_KEY')
if (testKey) {
  check('usage configured', payload.usage.configured === true)
  check('usage monthly percent', payload.usage.monthly && Number.isFinite(payload.usage.monthly.percent))
  check('usage weekly percent', payload.usage.weekly && Number.isFinite(payload.usage.weekly.percent))
  check('usage rolling percent', payload.usage.rolling && Number.isFinite(payload.usage.rolling.percent))
  check('usage status strings', payload.usage.monthly && typeof payload.usage.monthly.status === 'string')
  check('usage resetsAt ms', payload.usage.monthly && Number.isFinite(payload.usage.monthly.resetsAt))
  console.log('usage:', JSON.stringify({ rolling: payload.usage.rolling, weekly: payload.usage.weekly, monthly: payload.usage.monthly }))
} else {
  check('usage not configured', payload.usage.configured === false)
  check('usage unconfigured error', payload.usage.error && payload.usage.error.outcome === 'unconfigured')
}

// —— 实测探针 ——
check('liveProbe present', Boolean(payload.liveProbe))
check('liveProbe key ref', payload.liveProbe && payload.liveProbe.key.ref === 'OPENCODE_GO_API_KEY')
if (testKey) {
  check('liveProbe configured', payload.liveProbe.key.configured === true)
  check('liveProbe ok', payload.liveProbe.last && payload.liveProbe.last.ok === true)
  check('liveProbe ttft', payload.liveProbe.last && Number.isFinite(payload.liveProbe.last.ttft))
  check('liveProbe billing go', payload.liveProbe.last && payload.liveProbe.last.billingSource === 'go')
  check('liveProbe allowance', payload.liveProbe.last && Number.isFinite(payload.liveProbe.last.allowance))
  check('payload does not leak key', !shot.includes(testKey))
  // 手动探针 + 冷却
  const before = payload.liveProbe.last && payload.liveProbe.last.at
  const manual = await callHandler(routes[0], '/dsh-opencode/api/probe', 'POST', { model: 'deepseek-v4.1-flash' })
  console.log('manual probe http:', manual.status)
  check('manual probe 200', manual.status === 200)
  const manualPayload = JSON.parse(manual.text)
  check('manual probe advanced', manualPayload.liveProbe.last && manualPayload.liveProbe.last.at >= before)
  const again = await callHandler(routes[0], '/dsh-opencode/api/probe', 'POST', { model: 'deepseek-v4.1-flash' })
  check('manual probe cooldown 429', again.status === 429)
} else {
  check('liveProbe unconfigured outcome', payload.liveProbe.last && payload.liveProbe.last.outcome === 'unconfigured')
  check('liveProbe not configured', payload.liveProbe.key.configured === false)
}

// —— 运行设置：开关 / 间隔 / 持久化 ——
const settingsResponse = await callHandler(routes[0], '/dsh-opencode/api/settings', 'POST', {
  probeEnabled: false,
  usageEnabled: false,
  probeIntervalSeconds: 300,
  usageIntervalSeconds: 180,
})
check('settings POST 200', settingsResponse.status === 200)
const settingsPayload = JSON.parse(settingsResponse.text)
check('settings probe off', settingsPayload.settings.probeEnabled === false)
check('settings usage off', settingsPayload.settings.usageEnabled === false)
check('settings probe interval', settingsPayload.settings.probeIntervalSeconds === 300)
check('settings usage interval', settingsPayload.settings.usageIntervalSeconds === 180)
check('settings stops probe timer', settingsPayload.liveProbe.nextProbeAt === 0)
check('settings stops usage timer', settingsPayload.usage.nextAt === 0)
let savedSettings = null
try {
  savedSettings = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8'))
} catch {
  savedSettings = null
}
check('settings persisted to disk', savedSettings && savedSettings.probeEnabled === false && savedSettings.probeIntervalSeconds === 300)

const badInterval = await callHandler(routes[0], '/dsh-opencode/api/settings', 'POST', { probeIntervalSeconds: 5 })
const badIntervalPayload = JSON.parse(badInterval.text)
check('settings clamps out-of-range interval', badInterval.status === 200 && badIntervalPayload.settings.probeIntervalSeconds === 120)

const restored = await callHandler(routes[0], '/dsh-opencode/api/settings', 'POST', {
  probeEnabled: true,
  usageEnabled: true,
  probeIntervalSeconds: 120,
  usageIntervalSeconds: 60,
})
const restoredPayload = JSON.parse(restored.text)
check('settings restored', restored.status === 200 && restoredPayload.settings.probeEnabled === true && restoredPayload.settings.probeIntervalSeconds === 120)

// —— 专用 key 写入 / 清除（走内存凭据库） ——
const keySave = await callHandler(routes[0], '/dsh-opencode/api/key', 'POST', { value: 'smoke-test-key-value' })
check('key POST 200', keySave.status === 200)
const keyPayload = JSON.parse(keySave.text)
check('key saved dedicated', keyPayload.settings.key.dedicatedConfigured === true)
check('key state uses dedicated', keyPayload.settings.key.activeRef === 'DSH_OPENCODE_PROBE_KEY')
check('key not echoed', !keySave.text.includes('smoke-test-key-value'))
const badKey = await callHandler(routes[0], '/dsh-opencode/api/key', 'POST', { value: 'bad key with spaces' })
check('key rejects malformed', badKey.status === 400)
const keyClear = await callHandler(routes[0], '/dsh-opencode/api/key', 'DELETE')
const keyClearPayload = JSON.parse(keyClear.text)
check('key DELETE clears dedicated', keyClear.status === 200 && keyClearPayload.settings.key.dedicatedConfigured === false)

console.log('\n--- 摘要 ---')
console.log('overall:', payload.status.overall, '| quality:', payload.probe.quality, '| lastRtt:', payload.probe.lastRtt, 'ms')
console.log('go:', payload.status.goModels.map((model) => `${model.id} ${model.status} ${model.ttft}ms`).join(' | '))
console.log('catalog:', payload.goCatalog ? `${payload.goCatalog.models.length} models` : 'none', '| flash price:', catalogFlash && `${catalogFlash.inputPrice}/${catalogFlash.outputPrice} factor ${catalogFlash.peakFactor}`)
console.log('liveProbe:', JSON.stringify(payload.liveProbe.last))
console.log('payload bytes:', Buffer.byteLength(shot))

for (const dispose of disposers) {
  try {
    dispose()
  } catch {}
}
try {
  rmSync(settingsDir, { recursive: true, force: true })
} catch {}
console.log('done')
