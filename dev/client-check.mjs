/**
 * 浏览器半边的离线自检：不碰真实 DOM，用迷你 React 渲染器把 client.js 挂出来的
 * shell.overlay 组件渲染两遍（真实 /state 载荷、空态），检查树结构、文案与异常。
 * 只验证 JS 逻辑，不验证 CSS 与视觉——视觉仍需刷新后的页面确认。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const payloadPath = process.argv[2]
const payload = JSON.parse(readFileSync(payloadPath, 'utf8'))

const catalogFlash = payload.goCatalog && payload.goCatalog.models
  ? payload.goCatalog.models.find((model) => model.id === 'deepseek-v4.1-flash')
  : null
if (catalogFlash) catalogFlash.peakFactor = 2
if (payload.liveProbe && payload.liveProbe.today) {
  payload.liveProbe.today = { ...payload.liveProbe.today, count: Math.max(3, payload.liveProbe.today.count || 0), allowanceUsd: Math.max(0.000026, payload.liveProbe.today.allowanceUsd || 0) }
}

if (!payload.usage) {
  const now = Date.now()
  payload.usage = {
    enabled: true,
    configured: true,
    keyRef: 'OPENCODE_GO_API_KEY',
    intervalMs: 120000,
    nextAt: now + 90000,
    at: now - 30000,
    inFlight: false,
    error: null,
    rolling: { status: 'ok', percent: 1, resetsAt: now + 3 * 3600 * 1000 },
    weekly: { status: 'ok', percent: 0, resetsAt: now + 6 * 86400 * 1000 },
    monthly: { status: 'ok', percent: 42, resetsAt: now + 28 * 86400 * 1000 },
    rtt: 420,
  }
}

// 现场额度百分比会随时间变化；断言用固定值，但保留真实的 at/error/rtt 结构。
if (payload.usage) {
  const now = Date.now()
  payload.usage.rolling = { ...(payload.usage.rolling || {}), status: 'ok', percent: 1, resetsAt: now + 3 * 3600 * 1000 }
  payload.usage.weekly = { ...(payload.usage.weekly || {}), status: 'ok', percent: 2, resetsAt: now + 6 * 86400 * 1000 }
  payload.usage.monthly = { ...(payload.usage.monthly || {}), status: 'ok', percent: 42, resetsAt: now + 28 * 86400 * 1000 }
  payload.usage.at = now - 30000
  payload.usage.error = null
}

const DEFAULT_LIMITS = { probeMinSeconds: 120, probeMaxSeconds: 3600, usageMinSeconds: 60, usageMaxSeconds: 3600 }
if (!payload.settings) {
  payload.settings = {
    probeEnabled: true,
    usageEnabled: true,
    probeIntervalSeconds: 600,
    usageIntervalSeconds: 120,
    key: {
      dedicatedRef: 'DSH_OPENCODE_PROBE_KEY',
      providerRef: 'OPENCODE_GO_API_KEY',
      dedicatedConfigured: false,
      providerConfigured: true,
      activeRef: 'OPENCODE_GO_API_KEY',
      activeConfigured: true,
      dedicated: false,
      source: 'store',
    },
    limits: DEFAULT_LIMITS,
  }
} else {
  payload.settings = {
    ...payload.settings,
    probeEnabled: true,
    usageEnabled: true,
    probeIntervalSeconds: 600,
    usageIntervalSeconds: 120,
    key: {
      ...(payload.settings.key || {}),
      dedicatedRef: 'DSH_OPENCODE_PROBE_KEY',
      providerRef: 'OPENCODE_GO_API_KEY',
      dedicatedConfigured: false,
      providerConfigured: true,
      activeRef: 'OPENCODE_GO_API_KEY',
      activeConfigured: true,
      dedicated: false,
      source: 'store',
    },
    limits: payload.settings.limits || DEFAULT_LIMITS,
  }
}

if (!payload.liveProbe) {
  payload.liveProbe = {
    enabled: true,
    key: { ref: 'OPENCODE_GO_API_KEY', configured: true, source: 'store', checkedAt: Date.now() },
    model: 'deepseek-v4.1-flash',
    intervalMs: 600000,
    nextProbeAt: Date.now() + 420000,
    cooldownUntil: 0,
    inFlight: false,
    blocked: null,
    last: {
      at: Date.now() - 90000,
      ok: true,
      outcome: 'ok',
      model: 'deepseek-v4.1-flash',
      httpStatus: 200,
      ttft: 1876,
      total: 2100,
      allowance: 0.00000864,
      billingSource: 'go',
      logId: '01a1ba16-test',
    },
    history: [],
    successRate: 1,
    today: { day: '2026-11-08', count: 3, okCount: 3, allowanceUsd: 0.000026, listCostUsd: 0.000043 },
  }
}
// 现场载荷里的清单可能是非峰值（factor=1）；断言需要确定性的“峰值 ×2”，这里只改这一项。
if (!payload.goCatalog) {
  payload.goCatalog = {
    updatedAt: Date.now(),
    models: [{
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      family: 'deepseek-flash',
      protocols: ['chat-completions'],
      context: 1000000,
      outputLimit: 384000,
      inputPrice: 0.15,
      outputPrice: 0.6,
      cachedPrice: 0.003,
      peakFactor: 2,
      tools: true,
      reasoning: true,
    }],
  }
}

//#region 迷你 React

let currentInstance = null
let hookIndex = 0
let pendingEffects = []
let errors = []
let MODULE = null
let latestTree = null

const instances = new Map()
let scheduled = false
let rootElement = null

function createElement(type, props, ...children) {
  return { type, props: props || {}, children }
}

function currentInst() {
  if (!currentInstance) throw new Error('hook called outside render')
  return currentInstance
}

function useState(initial) {
  const inst = currentInst()
  const index = hookIndex++
  if (!(index in inst.hooks)) inst.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
  const slot = inst.hooks[index]
  const setter = (next) => {
    const value = typeof next === 'function' ? next(slot.value) : next
    if (Object.is(value, slot.value)) return
    slot.value = value
    scheduleRender()
  }
  return [slot.value, setter]
}

function useRef(initial) {
  const inst = currentInst()
  const index = hookIndex++
  if (!(index in inst.hooks)) inst.hooks[index] = { ref: { current: initial } }
  return inst.hooks[index].ref
}

function useCallback(fn, deps) {
  const inst = currentInst()
  const index = hookIndex++
  const previous = inst.hooks[index]
  const changed = !previous || !deps || !previous.deps || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
  if (changed) inst.hooks[index] = { value: fn, deps }
  return inst.hooks[index].value
}

function useMemo(fn, deps) {
  const inst = currentInst()
  const index = hookIndex++
  const previous = inst.hooks[index]
  const changed = !previous || !deps || !previous.deps || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
  if (changed) inst.hooks[index] = { value: fn(), deps }
  return inst.hooks[index].value
}

function useEffect(fn, deps) {
  const inst = currentInst()
  const index = hookIndex++
  const previous = inst.hooks[index]
  const changed = !previous || !deps || !previous.deps || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
  if (changed) {
    inst.hooks[index] = { deps }
    pendingEffects.push({ inst, fn })
  }
}

const React = { createElement, useState, useEffect, useRef, useCallback, useMemo }

//#endregion

//#region 迷你渲染器

function flattenChildren(children) {
  return children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
}

function renderNode(node, path) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) {
    return { kind: 'fragment', children: flattenChildren(node).map((child, index) => renderNode(child, `${path}[${index}]`)).filter(Boolean) }
  }
  const { type, props, children } = node
  if (typeof type === 'string') {
    const kids = flattenChildren(children.length ? children : props.children ? [props.children] : [])
    if (props.ref && typeof props.ref === 'object') {
      props.ref.current = {
        getBoundingClientRect: () => ({ left: 100, top: 72, width: 190, height: 34 }),
      }
    }
    return {
      kind: 'host',
      tag: type,
      props,
      children: kids.map((child, index) => renderNode(child, `${path}/${type}#${index}`)).filter(Boolean),
    }
  }
  if (typeof type === 'function') {
    const name = type.name || 'anonymous'
    const childPath = `${path}/${name}`
    let inst = instances.get(childPath)
    if (!inst) {
      inst = { hooks: {} }
      instances.set(childPath, inst)
    }
    const previousInstance = currentInstance
    const previousIndex = hookIndex
    currentInstance = inst
    hookIndex = 0
    const allProps = { ...props }
    if (children.length) allProps.children = children.length === 1 ? children[0] : children
    let output
    try {
      output = type(allProps)
    } catch (error) {
      errors.push(`${childPath}: ${error && error.stack ? error.stack.split('\n')[0] : error}`)
      output = null
    }
    currentInstance = previousInstance
    hookIndex = previousIndex
    return renderNode(output, childPath)
  }
  return null
}

function renderRoot() {
  errors = []
  pendingEffects = []
  hookIndex = 0
  const tree = renderNode(rootElement, 'root')
  latestTree = tree
  const effects = pendingEffects
  pendingEffects = []
  for (const { inst, fn } of effects) {
    try {
      const cleanup = fn()
      inst.cleanup = typeof cleanup === 'function' ? cleanup : null
    } catch (error) {
      errors.push(`effect: ${error && error.message ? error.message : error}`)
    }
  }
  return tree
}

function scheduleRender() {
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    renderRoot()
  }, 0)
}

function collectText(node, out = []) {
  if (!node) return out
  if (node.text !== undefined) out.push(node.text)
  if (node.children) for (const child of node.children) collectText(child, out)
  return out
}

function collectClasses(node, out = []) {
  if (!node) return out
  if (node.props && node.props.className) out.push(String(node.props.className))
  if (node.children) for (const child of node.children) collectClasses(child, out)
  return out
}

function countNodes(node, predicate) {
  let count = predicate(node) ? 1 : 0
  if (node && node.children) for (const child of node.children) count += countNodes(child, predicate)
  return count
}

function findAllNodes(node, predicate, out = []) {
  if (!node) return out
  if (predicate(node)) out.push(node)
  if (node.children) for (const child of node.children) findAllNodes(child, predicate, out)
  return out
}

function findNode(node, predicate) {
  if (!node) return null
  if (predicate(node)) return node
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, predicate)
      if (found) return found
    }
  }
  return null
}

function dumpTree(node, depth = 0, lines = []) {
  if (!node) return lines
  const pad = '  '.repeat(depth)
  if (node.text !== undefined) {
    const text = node.text.trim()
    if (text) lines.push(`${pad}"${text.slice(0, 90)}"`)
  } else if (node.kind === 'host') {
    const cls = node.props && node.props.className ? `.${String(node.props.className).split(' ')[0]}` : ''
    const extra = node.props && node.props['data-quality'] ? ` [q=${node.props['data-quality']}]` : ''
    lines.push(`${pad}<${node.tag}${cls}>${extra}`)
    for (const child of node.children) dumpTree(child, depth + 1, lines)
  } else if (node.kind === 'fragment') {
    lines.push(`${pad}fragment`)
    for (const child of node.children) dumpTree(child, depth + 1, lines)
  }
  return lines
}

//#endregion

//#region 环境桩

const storage = new Map()
const memoryStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

globalThis.window = {
  localStorage: memoryStorage,
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: {
    load(definition) {
      MODULE = definition
    },
  },
}
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
}

let fetchMode = 'ok'
const fetchCalls = []
globalThis.fetch = async (url, options = {}) => {
  if (fetchMode === 'error') throw new Error('fetch failed: host route unreachable')
  fetchCalls.push({ url: String(url), method: String(options.method || 'GET') })
  const target = String(url)
  if (target.includes('/settings')) {
    const patch = JSON.parse(options.body || '{}')
    const next = JSON.parse(JSON.stringify(payload))
    next.settings = { ...next.settings, ...patch }
    return { ok: true, status: 200, json: async () => next }
  }
  if (target.includes('/key')) {
    const deleting = String(options.method || '') === 'DELETE'
    const next = JSON.parse(JSON.stringify(payload))
    next.settings = {
      ...next.settings,
      key: {
        ...next.settings.key,
        dedicatedConfigured: !deleting,
        dedicated: !deleting,
        activeRef: deleting ? next.settings.key.providerRef : next.settings.key.dedicatedRef,
        activeConfigured: true,
      },
    }
    return { ok: true, status: 200, json: async () => next }
  }
  if (target.includes('/probe')) {
    const next = JSON.parse(JSON.stringify(payload))
    next.liveProbe.last = { ...next.liveProbe.last, ttft: 1234, at: Date.now(), manual: true }
    next.liveProbe.today = { ...next.liveProbe.today, count: next.liveProbe.today.count + 1 }
    return { ok: true, status: 200, json: async () => next }
  }
  return { ok: true, status: 200, json: async () => payload }
}

//#endregion

//#region 执行

const entry = new URL('../client.js', import.meta.url)
await import(entry.href)
if (!MODULE) throw new Error('client.js did not call __ModuleLoader__.load')
console.log('module id:', MODULE.id)

const registrations = []
const ctx = {
  get(name) {
    if (name === 'locale') return { getSnapshot: () => ({ active: 'zh' }) }
    return undefined
  },
  slots: {
    inject(slotName, callback) {
      callback()
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  },
}

MODULE.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})

const plugin = MODULE.factory
void plugin
// factory 在 load 时已经跑过，这里重新取返回对象
const exported = (() => {
  // 重新调用一次 factory 以获得返回值（幂等，只是构造组件树）
  return null
})()

// 直接重建：重新 load 太绕，改为从注册流程里拿 apply
// 上面 factory 调用的返回值没有被保存，重新执行一次 factory：
// __ModuleLoader__ 只保存了 definition，factory 是纯函数，直接再调一次即可。
const moduleApi = MODULE.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
moduleApi.apply(ctx)
console.log('registrations:', registrations.map((item) => `${item.spec.name}#${item.spec.id}`))

const widgetComponent = registrations[0].component
rootElement = React.createElement(widgetComponent, {})
renderRoot()
await new Promise((resolve) => setTimeout(resolve, 80))
renderRoot()

const text = collectText(latestTree).join(' ')
const classes = collectClasses(latestTree)

function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) process.exitCode = 1
}

check('no render errors', errors.length === 0)
if (errors.length) console.log('errors:', errors)
check('card rendered', classes.some((name) => name.includes('ocsw-card')))
check('model selector rendered', classes.some((name) => name.includes('ocsw-select')))
check('shows default model', text.includes('DeepSeek V4.1 Flash'))
check('shows link section', text.includes('线路'))
check('shows quality label', /优秀|良好|一般|较差|不稳定|中断|待测/.test(text))
check('shows ttft metric', text.includes('首字 TTFT'))
check('shows services', text.includes('推理') && text.includes('免费'))
check('shows sparkline', classes.some((name) => name.includes('ocsw-spark')))
check('shows data line', text.includes('7日排位') || text.includes('7日用量'))
check('probe section rendered', text.includes('实测 GO'))
check('probe shows ttft metric', text.includes('首字'))
check('probe shows allowance', text.includes('计入额度'))
check('probe shows billing source', text.includes('计费来源'))
check('probe shows go price and peak factor', text.includes('Go 现价') && text.includes('峰值 ×2'))
check('probe shows today usage', text.includes('今日') && text.includes('次'))
check('usage section rendered', text.includes('Go 额度'))
check('usage shows three windows', text.includes('5 小时') && text.includes('本周') && text.includes('本月'))
check('usage shows percent', text.includes('42%'))
check('usage shows reset hint', text.includes('后重置'))
check('usage shows updated time', text.includes('更新'))

// 手动「测一下」：应 POST /api/probe，并把返回值合并进状态
const actionNode = findNode(latestTree, (node) => node.props && String(node.props.className || '').split(' ').includes('ocsw-action'))
check('probe action rendered', Boolean(actionNode))
if (actionNode) {
  actionNode.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 120))
  renderRoot()
}
check('probe posted to host', fetchCalls.some((call) => call.url.includes('/probe') && call.method === 'POST'))
const probeTextAfter = collectText(latestTree).join(' ')
if (!probeTextAfter.includes('1.23')) console.log('probe text after click:', probeTextAfter.replace(/\s+/g, ' ').slice(0, 500))
check('probe result applied', probeTextAfter.includes('1.23'))

// —— 标题旁两个显式开关 ——
const chipNodes = findAllNodes(latestTree, (node) => node.props && String(node.props.className || '').split(' ').includes('ocsw-chipbtn'))
check('two header toggles', chipNodes.length === 2)
check('toggles default on', chipNodes.every((node) => node.props['data-on'] === 'true'))
chipNodes[0].props.onClick()
await new Promise((resolve) => setTimeout(resolve, 120))
renderRoot()
const textAfterOff = collectText(latestTree).join(' ')
check('probe toggle posted', fetchCalls.some((call) => call.url.includes('/settings') && call.method === 'POST'))
check('probe section hidden when off', !textAfterOff.includes('实测 GO'))
const chipAfterOff = findAllNodes(latestTree, (node) => node.props && String(node.props.className || '').split(' ').includes('ocsw-chipbtn'))
check('probe toggle shows off', chipAfterOff[0] && chipAfterOff[0].props['data-on'] === 'false')
chipAfterOff[0].props.onClick()
await new Promise((resolve) => setTimeout(resolve, 120))
renderRoot()
check('probe section back when on', collectText(latestTree).join(' ').includes('实测 GO'))

const statusTabDump = dumpTree(latestTree)
console.log('\n=== 状态页签结构（节选） ===')
console.log(statusTabDump.slice(0, 46).join('\n'))

// 数据页签：改 localStorage 后重建实例重新渲染
storage.set('dsh-opencode.ui.v1', JSON.stringify({ tab: 'data', model: 'deepseek-v4.1-flash', collapsed: false }))
instances.clear()
renderRoot()
await new Promise((resolve) => setTimeout(resolve, 80))
renderRoot()
const dataText = collectText(latestTree).join(' ')
check('data tab shows session cost', dataText.includes('会话成本'))
check('data tab shows cache hit', dataText.includes('缓存命中'))
check('data tab shows weekly rank', dataText.includes('本周用量榜'))
check('data tab shows share', dataText.includes('全站份额'))
check('data tab shows peak factor price', dataText.includes('峰值 ×2'))
console.log('\n=== 数据页签文本（节选） ===')
console.log(dataText.replace(/\s+/g, ' ').slice(0, 420))

// —— 设置页：间隔输入 + 专用 key ——
storage.set('dsh-opencode.ui.v1', JSON.stringify({ tab: 'settings', model: 'deepseek-v4.1-flash', collapsed: false }))
instances.clear()
renderRoot()
await new Promise((resolve) => setTimeout(resolve, 80))
renderRoot()
const settingsText = collectText(latestTree).join(' ')
check('settings tab rendered', settingsText.includes('专用 key') && settingsText.includes('分钟'))
check('settings has two switches', countNodes(latestTree, (node) => node.props && String(node.props.className || '').split(' ').includes('ocsw-switch')) === 2)
check('settings shows key source', settingsText.includes('provider key'))
const keyInput = findNode(latestTree, (node) => node.props && String(node.props.className || '').includes('ocsw-keyinput'))
check('settings key input rendered', Boolean(keyInput))
if (keyInput) {
  keyInput.props.onChange({ target: { value: 'ui-test-key-value' } })
  await new Promise((resolve) => setTimeout(resolve, 40))
  renderRoot()
  const saveButton = findNode(latestTree, (node) => node.props && String(node.props.className || '').split(' ').includes('ocsw-action') && collectText(node).join(' ').includes('保存'))
  check('settings save button rendered', Boolean(saveButton))
  if (saveButton) {
    saveButton.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 120))
    renderRoot()
  }
  check('key save posted', fetchCalls.some((call) => call.url.includes('/key') && call.method === 'POST'))
  check('key saved notice', collectText(latestTree).join(' ').includes('已保存'))
}


// 收起态
storage.set('dsh-opencode.ui.v1', JSON.stringify({ collapsed: true }))
instances.clear()
renderRoot()
await new Promise((resolve) => setTimeout(resolve, 80))
const pillClasses = collectClasses(latestTree)
const pillText = collectText(latestTree).join(' ')
check('collapsed pill rendered', pillClasses.some((name) => name.includes('ocsw-pill')))
check('pill shows Go', pillText.includes('Go'))
check('pill has no grip dots', !findNode(latestTree, (node) => node.props && node.props.className === 'ocsw-grip'))
const styleNode = findNode(latestTree, (node) => node.tag === 'style')
const cssText = styleNode && styleNode.props && styleNode.props.dangerouslySetInnerHTML ? styleNode.props.dangerouslySetInnerHTML.__html : ''
check('pill locked to a single line', /\.ocsw-pill\{[^}]*white-space:nowrap/.test(cssText) && /\.ocsw-pill\{[^}]*width:max-content/.test(cssText))
console.log('pill text:', pillText.replace(/\s+/g, ' '))

// 收起态拖拽：pointerdown → move → up，坐标应落到 left/top；随后 click 只代表拖动、不展开
const pillNode = findNode(latestTree, (node) => node.props && String(node.props.className || '').includes('ocsw-pill'))
check('pill exposes pointer handlers', Boolean(pillNode && typeof pillNode.props.onPointerDown === 'function'))
const pillProps = pillNode ? pillNode.props : {}
const makeEvent = (x, y) => ({
  button: 0,
  clientX: x,
  clientY: y,
  pointerId: 1,
  target: { closest: () => null },
  currentTarget: { setPointerCapture() {} },
})
pillProps.onPointerDown(makeEvent(150, 90))
pillProps.onPointerMove(makeEvent(190, 120))
pillProps.onPointerUp(makeEvent(190, 120))
await new Promise((resolve) => setTimeout(resolve, 40))
const rootNode = findNode(latestTree, (node) => node.props && String(node.props.className || '') === 'ocsw-root')
check('pill drag updates position', Boolean(rootNode && rootNode.props.style && Math.round(rootNode.props.style.left) === 140 && Math.round(rootNode.props.style.top) === 102))
pillProps.onClick({})
await new Promise((resolve) => setTimeout(resolve, 40))
check('click after drag does not expand', !findNode(latestTree, (node) => node.props && String(node.props.className || '').includes('ocsw-card')))
const pillNode2 = findNode(latestTree, (node) => node.props && String(node.props.className || '').includes('ocsw-pill'))
pillNode2.props.onClick({})
await new Promise((resolve) => setTimeout(resolve, 40))
check('plain click still expands', Boolean(findNode(latestTree, (node) => node.props && String(node.props.className || '').includes('ocsw-card'))))

// 宿主不可达
storage.delete('dsh-opencode.ui.v1')
instances.clear()
fetchMode = 'error'
renderRoot()
await new Promise((resolve) => setTimeout(resolve, 120))
renderRoot()
const errorText = collectText(latestTree).join(' ')
check('error state shows reason', /不可用|失败|fetch failed/.test(errorText))
console.log('error text:', errorText.replace(/\s+/g, ' ').slice(0, 200))

console.log('\nrender errors:', errors.length ? errors : 'none')
process.exit(process.exitCode || 0)
