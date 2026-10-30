/**
 * 客户端冒烟测试：用一个极简 React 替身把 client.js 跑起来，确认组件不炸、
 * 百分比文案/颜色/按钮状态都对。不追求渲染精度，只要能暴露拼写与逻辑错误。
 */
const fs = await import('node:fs')
const path = await import('node:path')
const { pathToFileURL } = await import('node:url')

/* ---------------- 极简 hooks 运行时 ---------------- */
let hooks = []
let cursor = 0
let pending = false
let renderFn = null

function resetHooks() {
  cursor = 0
}

function schedule() {
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    renderFn()
  })
}

function useHook(init) {
  const index = cursor++
  if (hooks.length <= index) hooks[index] = init()
  return index
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
  },
  useState(initial) {
    const index = useHook(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    const slot = hooks[index]
    return [
      slot.value,
      (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        schedule()
      },
    ]
  },
  useRef(initial) {
    const index = useHook(() => ({ current: initial }))
    return hooks[index]
  },
  useEffect(fn, deps) {
    const index = useHook(() => ({ deps: undefined, cleanup: undefined }))
    const slot = hooks[index]
    const changed =
      slot.deps === undefined ||
      deps === undefined ||
      deps.length !== slot.deps.length ||
      deps.some((d, i) => d !== slot.deps[i])
    if (!changed) return
    if (typeof slot.cleanup === 'function') slot.cleanup()
    slot.deps = deps
    slot.cleanup = fn()
  },
  useCallback(fn, deps) {
    const index = useHook(() => ({ fn, deps }))
    const slot = hooks[index]
    const changed =
      slot.deps === undefined ||
      deps === undefined ||
      deps.length !== slot.deps.length ||
      deps.some((d, i) => d !== slot.deps[i])
    if (changed) {
      slot.fn = fn
      slot.deps = deps
    }
    return slot.fn
  },
}

/* ---------------- 宿主环境替身 ---------------- */
const store = new Map()
const listeners = new Map()

globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
  },
  removeEventListener: (type, fn) => {
    listeners.get(type)?.delete(fn)
  },
  dispatchEvent: (event) => {
    for (const fn of listeners.get(event.type) ?? []) fn(event)
    return true
  },
  setInterval: () => 0,
  clearInterval: () => undefined,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
}

let styles = []
globalThis.Event = class Event {
  constructor(type) {
    this.type = type
  }
}
globalThis.document = {
  createElement(tag) {
    return { tag, textContent: '', setAttribute() {}, remove() {}, appended: false }
  },
  head: {
    appendChild(node) {
      node.appended = true
      styles.push(node)
    },
  },
}

const API_BODY = process.env.SMOKE_BODY ?? JSON.stringify({
  ok: true,
  count: 29,
  bytes: 6612,
  pct: 40.4,
  rawPct: 40.4,
  maxHeader: 16384,
  bytesPerCookie: 228,
  threshold: 71,
  remaining: 42,
  level: 'ok',
})

let fetchCalls = 0
globalThis.fetch = async (url, init) => {
  fetchCalls += 1
  fetchLog.push({ url, method: (init && init.method) ?? 'GET' })
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(process.env.SMOKE_POST_BODY ?? API_BODY),
  }
}
const fetchLog = []

let plugin
globalThis.window.__ModuleLoader__ = {
  load({ id, factory }) {
    plugin = { id, ...factory((name) => (name === 'react' ? React : undefined)) }
  },
}

/* ---------------- 序列化元素树 ---------------- */
function styleText(style) {
  if (style === undefined || style === null) return ''
  return Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';')
}

function render(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  const { type, props, children } = node
  if (typeof type === 'function') return render(type(props))
  const cls = props.className ? ` class="${props.className}"` : ''
  const st = props.style ? ` style="${styleText(props.style)}"` : ''
  const dis = props.disabled ? ' disabled' : ''
  return `<${type}${cls}${st}${dis}>${children.map(render).join('')}</${type}>`
}

/* ---------------- 跑起来 ---------------- */
const clientPath = new URL('../client.js', import.meta.url)
const source = fs.readFileSync(clientPath, 'utf8')
new Function(source)()

console.log('plugin id =', plugin.id, '| inject =', JSON.stringify(plugin.inject))

const registered = new Map()
plugin.apply({
  effect(cb) {
    const dispose = cb()
    return () => typeof dispose === 'function' && dispose()
  },
  slots: {
    inject(name, cb) {
      console.log('slots.inject', name)
      cb()
    },
    register(meta, comp) {
      registered.set(meta.name, { meta, comp })
      return () => undefined
    },
  },
})

const overlayEntry = registered.get('shell.overlay')
const tabEntry = registered.get('conversation.session.header.utilities')
let overlayMeta = overlayEntry && overlayEntry.meta
let Component = overlayEntry && overlayEntry.comp

console.log('style injected =', styles.length, '| overlay =', JSON.stringify(overlayMeta))

function paint(label) {
  resetHooks()
  let tree
  renderFn = () => {
    resetHooks()
    tree = Component()
  }
  renderFn()
  const html = render(tree)
  console.log(`\n--- ${label} ---`)
  console.log(html.replace(/></g, '>\n<'))
  return html
}

const initial = paint('首次渲染（数据未到）')
await new Promise((r) => setTimeout(r, 60))
const loaded = paint('拉取完成')
console.log('\nfetch 调用：', JSON.stringify(fetchLog))

const pctMatch = loaded.match(/class="dcm-pct"[^>]*>([\s\S]*?)<\/div>/)
console.log('百分比节点 =', pctMatch && pctMatch[1].replace(/<[^>]+>/g, ''))
console.log('红色提示 =', loaded.includes('#FF4D5E') ? '是' : '否')
console.log('按钮文案 =', (loaded.match(/class="dcm-btn[^"]*"[^>]*>([^<]+)</) ?? [])[1])
console.log('状态行 =', (loaded.match(/class="dcm-status">[\s\S]*?<span>([^<]+)<\/span>/) ?? [])[1])

/* ---------------- 顶栏按钮 ---------------- */
if (tabEntry) {
  Component = tabEntry.comp
  paint('顶栏按钮（挂载）')
  await new Promise((r) => setTimeout(r, 60))
  const tabLoaded = paint('顶栏按钮（拉取完成）')
  console.log('顶栏按钮文案 =', (tabLoaded.match(/>([^<>]*鲸[^<>]*)</) ?? [])[1])
  console.log('顶栏按钮高亮 =', tabLoaded.includes('dcm-tab-btn-on') ? '是' : '否')

  resetHooks()
  const tabNode = Component()
  console.log('顶栏按钮 onClick =', typeof tabNode.props.onClick === 'function' ? '有' : '无')
  tabNode.props.onClick()
  console.log('点一下后 hidden 键 =', store.get('dsh.cookie-meter.hidden') ?? '(已清)')
  console.log('dcm:hide 监听数 =', (listeners.get('dcm:hide') ?? new Set()).size)

  const ok = initial.length > 0 && loaded.includes('dcm-pct') && tabLoaded.includes('%') && store.get('dsh.cookie-meter.hidden') === '1'
  console.log('\nSMOKE OK =', ok)
  process.exitCode = ok ? 0 : 1
} else {
  console.log('\n未注册顶栏按钮（conversation.session.header.utilities）')
  console.log('\nSMOKE OK =', initial.length > 0 && loaded.includes('dcm-pct'))
}
