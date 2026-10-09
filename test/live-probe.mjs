// One-off live probe: drives a headless Chrome against the RUNNING harness GUI
// and asks the plugin's own diagnostics what the host layout really does.
//   node test/live-probe.mjs [url]
// It is a debugging tool, not part of the test suite: it needs the app running.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9227
const USER_DATA = path.join(here, '_chrome-live')
const URL = process.argv[2] ?? 'http://127.0.0.1:19387'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
await connect(target.webSocketDebuggerUrl)
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: URL })

// Wait for the plugin's console handle to appear (the app boots a whole shell first).
let ready = false
for (let i = 0; i < 30 && !ready; i += 1) {
  await sleep(500)
  try {
    ready = await evaluate('typeof window.__DSH_BUBBLE_FOLD__ === "object"')
  } catch { /* page still loading */ }
}
console.log('plugin handle ready:', ready)
if (!ready) {
  console.log('\n--- page diagnostics ---')
  console.log(JSON.stringify(await evaluate(`(() => {
    const boot = window.__DSH_BOOT__ ?? null
    return {
      url: location.href,
      title: document.title,
      bootType: typeof boot,
      bootKeys: boot && typeof boot === 'object' ? Object.keys(boot).slice(0, 20) : null,
      bootText: typeof boot === 'string' ? boot.slice(0, 400) : (boot ? JSON.stringify(boot).slice(0, 900) : null),
      scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).slice(0, 8),
      bodyStart: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300)
    }
  })()`), null, 2))
  console.log('page errors:', JSON.stringify(pageErrors, null, 2))
  chrome.kill()
  process.exit(0)
}

console.log('\n--- status / settings ---')
console.log(JSON.stringify(await evaluate(`(() => {
  const h = window.__DSH_BUBBLE_FOLD__
  if (!h) return { present: false }
  return { status: h.status, rightbarSetting: h.settings()?.rightbarRatio, rightbar: h.rightbar() }
})()`), null, 2))

console.log('\n--- layout shape ---')
console.log(JSON.stringify(await evaluate(`window.__DSH_BUBBLE_FOLD__.layoutDebug()`), null, 2))

console.log('\n--- experiment: setRightbar(60%) ---')
console.log(JSON.stringify(await evaluate(`window.__DSH_BUBBLE_FOLD__.layoutTry(60)`), null, 2))

console.log('\n--- after setRightbarRatio(60) through the plugin ---')
console.log(JSON.stringify(await evaluate(`(async () => {
  const h = window.__DSH_BUBBLE_FOLD__
  h.setRightbarRatio(60)
  await new Promise((r) => setTimeout(r, 600))
  return { setting: h.settings()?.rightbarRatio, rightbar: h.rightbar() }
})()`), null, 2))

console.log('\n--- DOM: every grid with 3 tracks ---')
console.log(JSON.stringify(await evaluate(`(() => {
  const out = []
  for (const el of document.querySelectorAll('div')) {
    const style = getComputedStyle(el)
    if (style.display !== 'grid') continue
    const tracks = style.gridTemplateColumns
    if (tracks.split(' ').length < 3) continue
    out.push({
      cls: String(el.className).slice(0, 60),
      attrs: [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).slice(0, 10),
      tracks,
      rect: Math.round(el.getBoundingClientRect().width)
    })
    if (out.length >= 4) break
  }
  return { viewport: window.innerWidth, grids: out }
})()`), null, 2))

console.log('\npage errors:', JSON.stringify(pageErrors, null, 2))
chrome.kill()
process.exit(0)
