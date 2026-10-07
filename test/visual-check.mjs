// Visual + behaviour check in a real headless Chrome against a host-like fixture
// with two turns, in both layouts the host really renders (grouped step container
// and inline/verbose). No live host needed.
//   node test/visual-check.mjs
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
/** Screenshots land in the repo's own asset folder: the README embeds these. */
const ASSETS = path.join(here, '..', 'assets')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9226
const USER_DATA = path.join(here, '_chrome-visual')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let socket = null
let nextId = 1
const pending = new Map()
const consoleErrors = []
const connect = async (url) => {
  socket = new WebSocket(url)
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true })
    socket.addEventListener('error', rej, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text)
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
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await mkdir(ASSETS, { recursive: true })
  await writeFile(path.join(ASSETS, name), Buffer.from(data, 'base64'))
  console.log('screenshot: assets/' + name)
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1000,1600', 'about:blank'
], { stdio: 'ignore' })

let target = null
for (let i = 0; i < 40 && !target; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((e) => e.type === 'page')
  } catch { /* not up */ }
}
await connect(target.webSocketDebuggerUrl)
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: pathToFileURL(path.join(here, 'visual-fixture.html')).href })
await sleep(2500)

console.log('plugin  :', JSON.stringify(await evaluate(`(() => {
  const h = window.__DSH_BUBBLE_FOLD__
  return h ? { status: h.status, settings: h.settings(), stats: h.stats() } : { present: false }
})()`)))

console.log('messages:', JSON.stringify(await evaluate(`(() => {
  const describe = (id) => {
    const body = document.getElementById(id)
    const anchor = body.closest('[data-chat-flow-kind]')
    return {
      clamped: body.getAttribute('data-lf-clamped'),
      visibleHeight: Math.round(body.getBoundingClientRect().height),
      naturalHeight: body.scrollHeight,
      toggle: anchor.querySelector('[data-lf-toggle]')?.textContent ?? null
    }
  }
  return { oldUser: describe('userLong1'), oldReply: describe('replyLong1'), newUser: describe('userLong2'), newReply: describe('replyLong2') }
})()`), null, 2))

console.log('seams   :', JSON.stringify(await evaluate(`(() => [...document.querySelectorAll('[data-lf-step-toggle]')].map((seam) => ({
  label: seam.getAttribute('aria-label'),
  title: seam.getAttribute('title'),
  above: seam.previousElementSibling?.getAttribute('data-chat-anchor-key') ?? seam.previousElementSibling?.getAttribute('data-chat-flow-kind'),
  below: seam.nextElementSibling?.getAttribute('data-chat-anchor-key'),
  bubblePx: (() => { const r = seam.querySelector('[data-lf-bubble]').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })(),
  centered: (() => {
    const rect = seam.getBoundingClientRect()
    const bubble = seam.querySelector('[data-lf-bubble]').getBoundingClientRect()
    return Math.abs((bubble.left + bubble.width / 2) - (rect.left + rect.width / 2)) < 1
  })()
})))()`), null, 2))

await shot('step-fold-default.png')

console.log('default fold state:', JSON.stringify(await evaluate(`(() => {
  const header = document.querySelector('.groupHeader')
  const body = document.getElementById('body-1')
  const inlineRows = [...document.querySelectorAll('.member')].slice(3)
  return {
    groupHeaderExpanded: header.getAttribute('aria-expanded'),
    groupBodyDisplay: getComputedStyle(body).display,
    inlineRowsFoldMarked: inlineRows.map((row) => row.getAttribute('data-lf-step-folded')),
    inlineRowsDisplay: inlineRows.map((row) => getComputedStyle(row).display),
    markedRows: document.querySelectorAll('[data-lf-step-folded]').length
  }
})()`), null, 2))

// One click per seam expands its block; nothing may re-collapse it afterwards.
console.log('expand  :', JSON.stringify(await evaluate(`(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const seams = [...document.querySelectorAll('[data-lf-step-toggle]')]
  for (const seam of seams) seam.click()
  await frame()
  const header = document.querySelector('.groupHeader')
  const body = document.getElementById('body-1')
  const inlineRows = [...document.querySelectorAll('.member')].slice(3)
  return {
    labels: seams.map((seam) => seam.getAttribute('aria-label')),
    groupHeaderExpanded: header.getAttribute('aria-expanded'),
    groupBodyDisplay: getComputedStyle(body).display,
    inlineRowsDisplay: inlineRows.map((row) => getComputedStyle(row).display),
    markedRows: document.querySelectorAll('[data-lf-step-folded]').length
  }
})()`), null, 2))
await sleep(400)
await shot('step-fold-expanded.png')

console.log('stays open:', JSON.stringify(await evaluate(`(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  window.__DSH_BUBBLE_FOLD__.rescan()
  await frame()
  window.__DSH_BUBBLE_FOLD__.rescan()
  await frame()
  return {
    groupHeaderExpanded: document.querySelector('.groupHeader').getAttribute('aria-expanded'),
    markedRows: document.querySelectorAll('[data-lf-step-folded]').length,
    seamLabels: [...document.querySelectorAll('[data-lf-step-toggle]')].map((seam) => seam.getAttribute('aria-label'))
  }
})()`), null, 2))

console.log('errors  :', JSON.stringify(consoleErrors.slice(0, 5)))

await send('Browser.close').catch(() => {})
chrome.kill()
process.exit(0)
