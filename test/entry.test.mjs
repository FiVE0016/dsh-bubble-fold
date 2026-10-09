// Plain-Node checks for the client entry: the settings-tab and right-sidebar-find
// registration contracts that only run inside the real host. The DOM-layer
// behaviour stays in runtime.test.mjs; this file covers the ctx slice with a
// faked loader.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'src', 'client-entry.js'), 'utf8')
const foldModule = await import(pathToFileURL(path.join(here, '..', 'src', 'fold.js')).href)

const FIND_TAB_ID = 'bubble-fold-find'

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/** Boot the entry in a sandbox with a faked loader surface. */
const runEntry = (options = {}) => {
  let registration = null
  const listeners = {}
  const fakeController = {
    applied: [],
    disposed: false,
    settings: () => ({ enabled: true, userLines: 6, assistantLines: 10, extraPx: 8 }),
    update(patch) { this.applied.push(patch) },
    subscribe(fn) { this.listener = fn; return () => { this.listener = null } },
    rescan() {},
    stats: () => ({}),
    setHeight() {},
    resetHeight() {},
    dispose() { this.disposed = true }
  }
  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}
  }
  const win = {
    __ModuleLoader__: { load: (row) => { registration = row } },
    __DSH_BUBBLE_FOLD_MODULES__: {
      './src/browser.js': { start: () => fakeController },
      './src/fold.js': {},
      './src/settings-panel.js': { createPanel: () => () => null },
      './src/find-panel.js': { createFindPanel: () => ({ Panel: () => null, Title: () => null }) }
    },
    // The entry derives every browser global from `document.defaultView ?? window`;
    // the real page supplies these, so the sandbox must too.
    navigator: { userAgent: options.userAgent ?? '' },
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({}),
    requestAnimationFrame: () => 0,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0 },
    clearTimeout: () => {},
    MutationObserver: class {},
    HTMLElement: class {},
    Element: class {},
    addEventListener: (type, handler) => { (listeners[type] ??= []).push(handler) },
    removeEventListener: () => {}
  }
  const fakeDocument = { defaultView: null }
  const fn = new Function('window', 'document', 'console', source)
  fn(win, fakeDocument, { warn() {}, error() {}, log() {} })
  const plugin = registration.factory((name) => (name === 'react' ? fakeReact : null))
  return { plugin, win, fakeController, listeners }
}

/** A ctx with the slot ledger plus the right-bar services the entry asks for. */
const makeCtx = () => {
  const registrations = new Map()
  const tabs = []
  const opened = []
  const ctx = {
    slots: {
      // The host projects the ledger lazily: inject() records the callback, and
      // the callback is what performs the actual register().
      inject: (_name, callback) => { callback(); return () => {} },
      register: (options, component) => {
        registrations.set(options.name, { options, component })
        return () => {}
      }
    },
    get: (name) => {
      if (name === 'sidebarRightTabs') {
        return { register: (definition) => { tabs.push(definition); return () => {} } }
      }
      if (name === 'sidebarRight') return { openTab: (id) => { opened.push(id) } }
      if (name === 'layout') return { openRightbar: () => {} }
      return undefined
    }
  }
  return { ctx, registrations, tabs, opened }
}

test('declares the slots dependency the panels need', () => {
  const { plugin } = runEntry()
  assert.ok(plugin.inject.includes('slots'), `inject: ${JSON.stringify(plugin.inject)}`)
})

test('registers one tab into settings.plugins.tab', () => {
  const { plugin } = runEntry()
  const { ctx, registrations } = makeCtx()
  plugin.apply(ctx)
  const tab = registrations.get('settings.plugins.tab')
  assert.ok(tab, 'the settings tab was registered')
  assert.equal(tab.options.id, 'bubble-fold', 'a fresh id adds a tab beside "all"')
  assert.equal(tab.options.order, 20)
  assert.equal(tab.options.label, 'UI 美化')
  assert.equal(typeof tab.component, 'function', 'the panel component is a function')
})

test('registers the find panel as a RIGHT sidebar tab, not a left-column panel', () => {
  const { plugin } = runEntry()
  const { ctx, registrations, tabs } = makeCtx()
  plugin.apply(ctx)
  assert.equal(tabs.length, 1, 'exactly one tab type is declared')
  assert.equal(tabs[0].id, FIND_TAB_ID)
  assert.equal(tabs[0].kind, FIND_TAB_ID, 'the kind matches the id, as the shipped panels do')
  assert.equal(typeof tabs[0].title, 'function', 'the title is a thunk so it follows the locale')
  const body = registrations.get('sidebar.right.pane.tab')
  assert.ok(body, 'the body registers under the keyed pane.tab seat')
  assert.equal(body.options.key, FIND_TAB_ID, 'keyed by the tab type id')
  assert.equal(typeof body.component, 'function')
  const title = registrations.get('sidebar.right.pane.tab.title')
  assert.ok(title, 'the chip registers too')
  assert.equal(title.options.key, FIND_TAB_ID)
  assert.equal(registrations.has('sidebar.panellist'), false, 'the left sidebar entry is gone')
  assert.equal(registrations.has('main'), false, 'and so is the left-column panel')
})

test('the tab api writes through to the running controller', () => {
  const { plugin, fakeController } = runEntry()
  const { ctx, registrations } = makeCtx()
  plugin.apply(ctx)
  const props = registrations.get('settings.plugins.tab').options.inject()
  props.api.update({ userLines: 9 })
  assert.deepEqual(fakeController.applied.at(-1), { userLines: 9 })
  assert.equal(props.api.settings().userLines, 6, 'reads come from the controller')
  const off = props.api.subscribe(() => {})
  assert.equal(typeof off, 'function', 'subscribe hands back an unsubscribe')
})

test('Ctrl+F opens the find tab in the desktop app, and is left alone in a browser', () => {
  const desktop = runEntry({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/152 Electron/44.0.0 Safari/537.36' })
  const desktopCtx = makeCtx()
  desktop.plugin.apply(desktopCtx.ctx)
  const handler = (desktop.listeners.keydown ?? [])[0]
  assert.ok(handler, 'the desktop key route was installed')
  const event = { key: 'f', ctrlKey: true, shiftKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true } }
  handler(event)
  assert.equal(event.prevented, true, 'the platform find is not left to do nothing')
  assert.deepEqual(desktopCtx.opened, [FIND_TAB_ID], 'the find tab is opened')

  const browser = runEntry({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/152.0 Safari/537.36' })
  const browserCtx = makeCtx()
  browser.plugin.apply(browserCtx.ctx)
  assert.equal((browser.listeners.keydown ?? []).length, 0, 'a real browser keeps its own Ctrl+F')
})

test('without the right-bar service the layout is never touched', () => {
  const desktop = runEntry({ userAgent: 'Mozilla/5.0 Chrome/152 Electron/44.0.0 Safari/537.36' })
  const layoutCalls = []
  const registrations = new Map()
  const ctx = {
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (options, component) => { registrations.set(options.name, { options, component }); return () => {} }
    },
    // The services simply are not there — the shape a dynamic client half hits on
    // hosts that keep the right bar to first-party panels.
    get: (name) => (name === 'layout' ? { openRightbar: (...args) => layoutCalls.push(args) } : undefined)
  }
  desktop.plugin.apply(ctx)
  assert.equal(registrations.has('sidebar.right.pane.tab'), false, 'nothing was registered')
  const handler = (desktop.listeners.keydown ?? [])[0]
  const event = { key: 'f', ctrlKey: true, shiftKey: false, altKey: false, preventDefault() {} }
  handler(event)
  assert.deepEqual(layoutCalls, [], 'Ctrl+F must not open an empty right column')
})

test('the settings page covers every setting the in-page panel has', async () => {
  const { createPanel } = await import(pathToFileURL(path.join(here, '..', 'src', 'settings-panel.js')).href)
  // A minimal React stand-in: the panel only uses createElement/useState/useEffect.
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}
  }
  const settings = { ...foldModule.DEFAULT_SETTINGS }
  const api = {
    settings: () => settings,
    update: () => {},
    subscribe: () => () => {},
    composer: () => ({ min: 200, max: 900, value: 336, fallback: 336 }),
    setHeight: () => {},
    resetHeight: () => {},
    rightbar: () => ({ supported: true, ratio: 45 }),
    setRightbarRatio: () => {}
  }
  const tree = createPanel(React, api)({ api })

  // The tree is nested createElement objects; every control is built by Row with a
  // `label` prop, so collecting those labels proves the page is complete.
  const labels = []
  const walk = (node) => {
    if (Array.isArray(node)) { for (const child of node) walk(child); return }
    if (!node || typeof node !== 'object') return
    if (node.props?.label) labels.push(node.props.label)
    walk(node.props?.children)
  }
  walk(tree)

  // Mirrors the in-page panel row for row: 14 settings + the composer height.
  const expected = [
    '启用插件',
    '最新一轮保持展开',
    '折叠我的输入',
    '我的输入保留行数',
    '折叠助手回复',
    '助手回复保留行数',
    '全部消息都折叠',
    '折叠后保留行数',
    '折叠后与控件的间距 (px)',
    '步骤区与回复之间加折叠按钮',
    '步骤默认收起',
    '默认只留一个按钮',
    '按钮显示文字',
    '输入框可拖动调高',
    '右侧栏占比 (%)',
    '输入框高度'
  ]
  for (const label of expected) {
    assert.ok(labels.includes(label), `设置页缺少「${label}」`)
  }
  assert.equal(expected.length, Object.keys(foldModule.DEFAULT_SETTINGS).length + 1, 'no setting is left out')
})

test('a hostile restricted ctx cannot make apply throw (boot must survive)', () => {
  const { plugin, win, fakeController, listeners } = runEntry({
    userAgent: 'Mozilla/5.0 Chrome/152 Electron/44.0.0 Safari/537.36'
  })
  // The shape that once killed the boot: reading an UNKNOWN property off the
  // restricted context throws, and a throwing `dsh.client.immediately` row makes
  // the whole host fail to start (verified: "web boot: 1 entry did not activate").
  const slots = { inject: (_name, callback) => { callback(); return () => {} }, register: () => () => {} }
  const ctx = new Proxy({ slots, get: (name) => (name === 'layout' ? { openRightbar() {} } : undefined) }, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop !== 'string') return undefined
      throw new Error(`Unknown service: ${prop}`)
    }
  })
  assert.doesNotThrow(() => plugin.apply(ctx), 'apply must never throw at the host')
  assert.equal(win.__DSH_BUBBLE_FOLD__?.status, 'running', 'the fold itself still comes up')
  assert.equal(fakeController.disposed, false)
  // The key route may exist now; it must stay harmless without a registered tab.
  const handler = (listeners.keydown ?? [])[0]
  if (handler) {
    assert.doesNotThrow(() => handler({ key: 'f', ctrlKey: true, shiftKey: false, altKey: false, preventDefault() {} }))
  }
})

test('a host without a slots service still gets the working fold', () => {
  const { plugin, win } = runEntry()
  plugin.apply(null)
  assert.equal(win.__DSH_BUBBLE_FOLD__.status, 'running')
  assert.equal(typeof win.__DSH_BUBBLE_FOLD__.update, 'function')
})

test('dispose tears the panels down and frees the console handle', () => {
  const { plugin, win, fakeController } = runEntry()
  const { ctx } = makeCtx()
  const off = plugin.apply(ctx)
  off()
  assert.equal(fakeController.disposed, true, 'the DOM controller was disposed')
  assert.equal(win.__DSH_BUBBLE_FOLD__, undefined, 'the console handle is gone')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
