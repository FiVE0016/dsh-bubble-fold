// Browser acceptance check: drives a headless Chrome against a RUNNING harness
// web UI and verifies what only a real browser can show — that the plugin comes
// up from the INSTALLED package, folds a real conversation, and leaves the host's
// own browser behaviour (native find, print) intact.
//
//   dsh --profile web                 # prints http://127.0.0.1:<port>/?token=...
//   node test/browser-check.mjs "http://127.0.0.1:3080/?token=..."
//
// Unlike test/visual-check.mjs (which runs the build against a fixture) this needs
// the app running and a session that actually has messages. It is a checking tool,
// not part of CI.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9229
const USER_DATA = path.join(here, '_chrome-browser')
const URL = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!URL) {
  console.error('usage: node test/browser-check.mjs "<url with token>"')
  process.exit(2)
}

let socket = null
let nextId = 1
const pending = new Map()
const pageErrors = []
const connect = async (url) => {
  socket = new WebSocket(url)
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true })
    socket.addEventListener('error', rej, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`  ${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ' — ' + detail}`)
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' })

let target = null
for (let i = 0; i < 40 && !target; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((e) => e.type === 'page')
  } catch { /* not up yet */ }
}
if (!target) {
  console.error('headless Chrome did not come up')
  process.exit(1)
}
await connect(target.webSocketDebuggerUrl)
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: URL })

console.log('\n=== 1. 插件是否从已安装的包里跑起来 ===')
let ready = false
for (let i = 0; i < 40 && !ready; i += 1) {
  await sleep(500)
  try {
    ready = await evaluate('typeof window.__DSH_UI_BEAUTIFY__ === "object" || typeof window.__DSH_BUBBLE_FOLD__ === "object"')
  } catch { /* still booting */ }
}
const status = ready ? await evaluate('window.__DSH_UI_BEAUTIFY__?.status ?? window.__DSH_BUBBLE_FOLD__?.status ?? "missing"') : 'missing'
check('控制台句柄出现', ready === true, ready ? undefined : '句柄不存在，说明客户端半没有加载')
check('插件状态为 running', status === 'running', `status=${status}`)

console.log('\n=== 2. 真实会话里的折叠 ===')
const readDom = () => evaluate(`(() => {
  const count = (selector) => document.querySelectorAll(selector).length
  const bodies = [...document.querySelectorAll('[data-lf-body]')]
  const last = bodies[bodies.length - 1] ?? null
  return {
    flowRows: count('[data-chat-flow-kind]'),
    bodies: bodies.length,
    clamped: count('[data-lf-clamped="1"]'),
    open: count('[data-lf-open="1"]'),
    toggles: count('[data-lf-toggle]'),
    seams: count('[data-lf-step-line]'),
    primaries: count('[data-lf-step-all]'),
    composerSeat: count('[data-composer-seat]'),
    composerHandle: count('[data-lf-composer-handle]'),
    rootAttribute: document.documentElement.getAttribute('data-dsh-bubble-fold'),
    styleTag: Boolean(document.getElementById('dsh-bubble-fold-styles')),
    lastBodyClamped: last ? last.getAttribute('data-lf-clamped') === '1' : null
  }
})()`)
let dom = await readDom()

// This client has its own session, and a fresh one is empty. A past session from
// the sidebar is free to open and has real messages, so the check does not need
// the reader to click anything (and cannot see their tab anyway).
let switched = null
if (dom.bodies === 0) {
  switched = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('div[class*="sessionRow"]')]
    const other = rows.find((el) => !String(el.className).includes('selected'))
    if (!other) return { clicked: false, rows: rows.length }
    other.click()
    return { clicked: true, rows: rows.length, text: (other.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30) }
  })()`)
  for (let i = 0; i < 24 && dom.bodies === 0; i += 1) {
    await sleep(500)
    dom = await readDom()
  }
  console.log(`  切换到旧会话: ${JSON.stringify(switched)} → bodies=${dom.bodies}`)

  // The plugin scans history lazily — that is what keeps a 1000-row session cheap —
  // so the counts keep growing for a while after a session loads. Wait for them to
  // stop changing before asserting anything.
  let previous = -1
  for (let i = 0; i < 40; i += 1) {
    const now = dom.bodies + dom.clamped + dom.toggles + dom.seams
    if (now === previous && dom.bodies > 1) break
    previous = now
    await sleep(500)
    dom = await readDom()
  }
  console.log(`  扫描稳定后: bodies=${dom.bodies} clamped=${dom.clamped} seams=${dom.seams}`)

  // Older messages only become visible — and therefore scanned — after scrolling
  // back through history: the host renders lazily and the plugin measures what is
  // near the viewport. Walk up through the history until a clamped bubble shows up.
  if (dom.clamped === 0) {
    for (const fraction of [0.5, 0.25, 0.05, 0]) {
      const moved = await evaluate(`(() => {
        const scroller = [...document.querySelectorAll('*')]
          .filter((el) => el.scrollHeight > el.clientHeight + 200 && getComputedStyle(el).overflowY !== 'visible')
          .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
        if (!scroller) return null
        scroller.scrollTop = scroller.scrollHeight * ${fraction}
        return { top: Math.round(scroller.scrollTop), height: scroller.scrollHeight }
      })()`)
      if (!moved) break
      await sleep(2500)
      dom = await readDom()
      if (dom.clamped > 0) break
    }
    console.log(`  滚动历史后: bodies=${dom.bodies} clamped=${dom.clamped}`)
  }
}
console.log('  ' + JSON.stringify(dom))

check('样式已挂载到 root', dom.rootAttribute === 'on', `root=${dom.rootAttribute}`)
check('插件样式表存在', dom.styleTag === true)
if (dom.bodies === 0) {
  // An empty session is not a failure: it means there is nothing to fold yet.
  check('扫描到消息气泡', null, '当前会话没有消息：请在浏览器里打开一个有内容的会话（或发一条）后重跑')
  check('折叠生效', null, '同上')
} else {
  check('扫描到消息气泡', true, `bodies=${dom.bodies}`)
  check('折叠控件已渲染', dom.toggles > 0, `toggles=${dom.toggles}`)
  // The plugin only scans what is near the viewport (that is what keeps a long
  // session cheap), so a freshly opened session exposes just its newest messages:
  // clamping can only be judged after scrolling back through history.
  check('超长消息被折起', dom.clamped > 0 ? true : null,
    dom.clamped > 0 ? `clamped=${dom.clamped}` : '视口内没有超长消息：向上滚动加载更早的消息后再跑即可判定')
  check('最新一轮保持展开', dom.lastBodyClamped === false, `lastBodyClamped=${dom.lastBodyClamped}`)
}
if (dom.flowRows === 0) {
  check('工作步骤缝隙', null, '当前会话没有工作步骤')
} else {
  check('步骤折叠缝存在', dom.seams > 0, `seams=${dom.seams}`)
}
check('输入框手柄存在', dom.composerHandle > 0 || dom.composerSeat === 0,
  dom.composerSeat === 0 ? '当前页面没有输入框（非会话视图）' : `handle=${dom.composerHandle}`)

console.log('\n=== 3. 浏览器专属行为 ===')
const find = await evaluate(`(() => {
  const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return { prevented: event.defaultPrevented }
})()`)
// The plugin only takes Ctrl+F over when the UA carries Electron/; in a real
// browser the native find bar must stay in charge.
check('Ctrl+F 交给浏览器自己处理', find.prevented === false,
  find.prevented ? '被插件拦截了（在真浏览器里不该发生）' : '浏览器原生查找栏生效')

await send('Emulation.setEmulatedMedia', { media: 'print' })
const print = await evaluate(`(() => {
  const bodies = [...document.querySelectorAll('[data-lf-body]')]
  return {
    stillClamped: bodies.filter((b) => b.getAttribute('data-lf-clamped') === '1').length,
    controlsVisible: [...document.querySelectorAll('[data-lf-toggle]')].filter((el) => getComputedStyle(el).display !== 'none').length
  }
})()`)
await send('Emulation.setEmulatedMedia', { media: '' })
check('打印媒体下不再折叠', print.stillClamped === 0, `stillClamped=${print.stillClamped}`)
check('打印媒体下控件隐藏', print.controlsVisible === 0, `visible=${print.controlsVisible}`)

console.log('\n=== 4. 右栏宽度 ===')
const readFrame = () => evaluate(`(() => {
  const frame = [...document.querySelectorAll('div[style]')].find((el) => el.style && el.style.gridTemplateColumns)
  return {
    collapsed: frame ? frame.hasAttribute('data-rightbar-collapsed') : null,
    fullscreen: frame ? frame.hasAttribute('data-rightbar-fullscreen') : null,
    tracks: frame ? frame.style.gridTemplateColumns : null,
    forced: frame ? frame.hasAttribute('data-lf-frame') : null,
    thirdTrack: frame ? (frame.style.gridTemplateColumns.match(/minmax\\(0px, ([\\d.]+)px\\)/) ?? [])[1] : null
  }
})()`)
const clickByLabel = (label) => evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === ${JSON.stringify(label)})
  if (!el) return false
  el.click()
  return true
})()`)

const beforeOpen = await readFrame()
console.log('  ' + JSON.stringify(beforeOpen))
check('收起时没有占着那一列', beforeOpen.forced === false, beforeOpen.forced ? '仍在强制宽度' : '已释放')

const opened = await clickByLabel('打开右侧边栏')
if (!opened) {
  check('打开右栏并校验宽度', null, '没找到「打开右侧边栏」按钮（宿主改版了？）')
} else {
  await sleep(3000)
  const open = await readFrame()
  const rightbar = await evaluate('window.__DSH_UI_BEAUTIFY__?.rightbar() ?? null')
  console.log('  ' + JSON.stringify({ ...open, ...rightbar }))
  check('右栏显示时强制了设定宽度', open.forced === true, `tracks=${open.tracks}`)
  check('实际渲染宽度等于设置', rightbar?.ratio !== null && Math.abs((rightbar?.ratio ?? 0) - (rightbar?.renderedRatio ?? -1)) <= 2,
    `ratio=${rightbar?.ratio} rendered=${rightbar?.renderedRatio}`)

  // Closing is the regression that once left the conversation stuck at half width:
  // a forced `!important` column has to be released the moment the host closes.
  const closed = await clickByLabel('收起右侧边栏')
  await sleep(2500)
  const after = await readFrame()
  console.log('  ' + JSON.stringify(after))
  check('收起后释放那一列（会话区回弹）',
    closed === true && after.forced === false && /minmax\(0px, 0px\)/.test(after.tracks ?? ''),
    `forced=${after.forced} tracks=${after.tracks}`)
}

console.log('\n=== 5. 控制台报错 ===')
check('没有未捕获异常', pageErrors.length === 0, pageErrors.length ? JSON.stringify(pageErrors).slice(0, 300) : '0')

const failed = results.filter((r) => r.ok === false)
console.log(`\n小结: ${results.filter((r) => r.ok === true).length} 通过 / ${failed.length} 失败 / ${results.filter((r) => r.ok === null).length} 跳过`)
if (failed.length > 0) console.log('失败项: ' + failed.map((r) => r.name).join('、'))

chrome.kill()
process.exit(failed.length > 0 ? 1 : 0)
