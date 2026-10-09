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
  bubblePx: (() => { const r = seam.querySelector('[data-lf-icon]').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })(),
  centered: (() => {
    const rect = seam.getBoundingClientRect()
    const bubble = seam.querySelector('[data-lf-icon]').getBoundingClientRect()
    return Math.abs((bubble.left + bubble.width / 2) - (rect.left + rect.width / 2)) < 1
  })()
})))()`), null, 2))

// Let the fold settle (the fixture is heavy: the first passes share the frame
// budget) so the shot shows what the defaults really look like.
await evaluate(`window.__DSH_BUBBLE_FOLD__.rescan()`)
await sleep(700)
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

// The fold must land on a text boundary: a box cut to the exact line budget can
// slice the next line in half, which no fade hides any more.
console.log('cut     :', JSON.stringify(await evaluate(`(() => {
  const body = document.querySelector('[data-lf-clamped="1"]')
  if (!body) return { checked: false }
  const box = body.getBoundingClientRect()
  const top = box.top
  // Line boxes, not element boxes: this body is a text node with no children.
  const range = document.createRange()
  range.selectNodeContents(body)
  const ends = [...range.getClientRects()].map((rect) => Math.round(rect.bottom - top))
  const height = Math.round(box.height)
  // The real question: is any line box cut in half by the clamp?
  const sliced = [...range.getClientRects()].filter((rect) => (
    rect.top - top < height - 1 && rect.bottom - top > height + 1
  )).length
  return {
    clampHeight: height,
    varValue: body.parentElement.style.getPropertyValue('--lf-clamp-height'),
    boxSizing: getComputedStyle(body).boxSizing,
    paddingTop: getComputedStyle(body).paddingTop,
    lineBoxes: ends.length,
    slicedLines: sliced,
    boundaryAtCut: ends.includes(height),
    nearest: ends.filter((end) => Math.abs(end - height) <= 30).sort((a, b) => a - b)
  }
})()`), null, 2))

// The control row is real flow, not an overlay: it must start at or below the
// clamped box, never on top of the last visible line.
console.log('no overlap:', JSON.stringify(await evaluate(`(() => {
  const rows = []
  for (const tail of [...document.querySelectorAll('[data-lf-tail]')]) {
    if (tail.hidden) continue
    const body = tail.parentElement?.querySelector('[data-lf-clamped="1"]')
    if (!body) continue
    const box = body.getBoundingClientRect()
    const row = tail.getBoundingClientRect()
    rows.push({ gap: Math.round(row.top - box.bottom), overlaps: row.top < box.bottom })
  }
  return { checked: rows.length, rows }
})()`), null, 2))

// Print media must read as the whole conversation: clamped messages un-clamp,
// no overlay may remain over the text, host groups that hide with
// `hidden="until-found"` come back, and the plugin's own controls stay off the
// paper. Emulated here because the print media query is the only thing that
// makes this true.
await send('Emulation.setEmulatedMedia', { media: 'print' })
console.log('print   :', JSON.stringify(await evaluate(`(() => {
  const body = document.querySelector('[data-lf-clamped="1"]')
  const tail = document.querySelector('[data-lf-tail]')
  const until = [...document.querySelectorAll('[hidden="until-found"]')]
  return {
    clampedMaxHeight: body ? getComputedStyle(body).maxHeight : null,
    fadeAfter: body ? getComputedStyle(body, '::after').content : null,
    controlDisplay: tail ? getComputedStyle(tail).display : null,
    untilFoundVisibility: until.map((el) => getComputedStyle(el).contentVisibility),
    untilFoundDisplay: until.map((el) => getComputedStyle(el).display),
    untilFoundChildren: until.map((el) => el.childElementCount),
    untilFoundHeights: until.map((el) => Math.round(el.getBoundingClientRect().height))
  }
})()`), null, 2))
await send('Emulation.setEmulatedMedia', { media: 'screen' })

// The attribute-level part of the same promise: beforeprint must reveal the rows
// the plugin hides itself, and afterprint must put them back.
console.log('print ev:', JSON.stringify(await evaluate(`(() => {
  const count = () => document.querySelectorAll('[data-lf-step-folded]').length
  const before = count()
  window.dispatchEvent(new Event('beforeprint'))
  const during = count()
  window.dispatchEvent(new Event('afterprint'))
  return { before, during, after: count() }
})()`), null, 2))

// The three controls a Turn's last seam carries: the primary (展开全部 / 收起全部)
// and, while spread, 展开所有步骤 — with three distinct glyphs.
console.log('turn all:', JSON.stringify(await evaluate(`(() => {
  const shown = [...document.querySelectorAll('[data-lf-step-all]')].filter((all) => !all.hidden)
  const carrier = shown[0]?.closest('[data-lf-step-line]')
  const line = carrier
  const glyphs = line
    ? ['data-lf-step-toggle', 'data-lf-step-all', 'data-lf-step-every']
        .map((attr) => line.querySelector('[' + attr + ']')?.querySelector('[data-lf-icon]')?.innerHTML ?? '')
    : []
  return {
    seams: document.querySelectorAll('[data-lf-step-line]').length,
    primaries: shown.length,
    label: shown[0]?.getAttribute('aria-label') ?? null,
    title: shown[0]?.getAttribute('title') ?? null,
    aboveAnswer: carrier?.nextElementSibling?.getAttribute('data-chat-anchor-key') ?? null,
    distinctGlyphs: new Set(glyphs.filter(Boolean)).size
  }
})()`), null, 2))

// The three seam controls and the three states they drive:
//   状态0  one button (展开全部) → 状态1  seams spread, contents folded → 状态2  all content open.
console.log('states  :', JSON.stringify(await evaluate(`(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const visible = () => [...document.querySelectorAll('[data-lf-step-line]')].filter((l) => !l.hidden)
  // The fixture's LAST Turn is the one holding two blocks (its 展开所有步骤 control
  // is the one that will appear); every seam owns such a control in the DOM, so
  // picking by "has one" would land on a single-block Turn.
  const primaries = [...document.querySelectorAll('[data-lf-step-all]')].filter((b) => !b.hidden)
  const primary = primaries[primaries.length - 1]
  if (!primary) return { checked: false }
  const line = primary.closest('[data-lf-step-line]')
  const turn = line.getAttribute('data-lf-turn')
  const mine = [...document.querySelectorAll('[data-turn-process="' + turn + '"]')]
  const openCount = () => mine.filter((row) => row.hasAttribute('data-open')).length
  const state = {
    zero: {
      seams: visible().length,
      primary: primary.getAttribute('aria-label'),
      arrowHidden: line.querySelector('[data-lf-step-toggle]').hidden,
      everyHidden: line.querySelector('[data-lf-step-every]').hidden,
      openBlocks: openCount(),
      distinctGlyphs: new Set(['data-lf-step-toggle', 'data-lf-step-all', 'data-lf-step-every']
        .map((attr) => line.querySelector('[' + attr + ']')?.querySelector('[data-lf-icon]')?.innerHTML ?? '')
        .filter(Boolean)).size
    }
  }
  primary.click()
  await frame()
  state.one = {
    seams: visible().length,
    primary: primary.getAttribute('aria-label'),
    every: line.querySelector('[data-lf-step-every]').getAttribute('aria-label'),
    openBlocks: openCount()
  }
  line.querySelector('[data-lf-step-every]').click()
  await frame()
  state.two = {
    every: line.querySelector('[data-lf-step-every]').getAttribute('aria-label'),
    openBlocks: openCount()
  }
  primary.click()
  await frame()
  state.backToZero = {
    seams: visible().length,
    primary: primary.getAttribute('aria-label'),
    openBlocks: openCount()
  }
  return state
})()`), null, 2))

// Ctrl+F has to reach folded content. window.find() runs the browser's own text
// search — the same matching find-in-page does — so it answers "would the reader
// find this text?", which is exactly what `display: none` used to break. The
// reveal half (beforematch opening the block) is covered by the runtime tests.
console.log('find    :', JSON.stringify(await evaluate(`(() => {
  const found = (needle) => window.find(needle, false, false, true, false, false, false)
  const clamped = document.querySelector('[data-lf-clamped="1"]')
  const selfFolded = document.querySelector('[data-lf-step-folded]')
  const selfText = (selfFolded?.textContent || '').trim().slice(0, 10)
  const beforeOpen = clamped?.getAttribute('data-lf-open')
  const result = {
    clamped: {
      found: found('旧输入第 20 行'),
      overflowY: clamped ? getComputedStyle(clamped).overflowY : null,
      scrollable: clamped ? clamped.scrollHeight > clamped.clientHeight : null,
      // The box is clipped, not a scroll container: a wheel cannot move it, and
      // only a script can (which the find panel does not need).
      programmaticScrollTop: (() => {
        if (!clamped) return null
        clamped.scrollTop = 90
        const moved = clamped.scrollTop
        clamped.scrollTop = 0
        return moved
      })()
    },
    selfFolded: {
      hidden: selfFolded?.getAttribute('hidden') ?? null,
      contentVisibility: selfFolded ? getComputedStyle(selfFolded).contentVisibility : null,
      found: selfText ? found(selfText) : null
    },
    // The host folds its own groups with the same mechanism; window.find() is not
    // a faithful proxy for that path (the reveal belongs to find-in-page), so this
    // only reports what the host itself set.
    hostFold: (() => {
      const body = document.querySelector('[data-step-process-body][hidden], [hidden="until-found"]')
      return body ? { hidden: body.getAttribute('hidden'), contentVisibility: getComputedStyle(body).contentVisibility } : null
    })()
  }
  // What the browser does to reveal a match inside a folded message: it scrolls
  // the box. The plugin answers by opening the message rather than leaving a
  // clipped view behind.
  if (clamped) {
    clamped.scrollTop = 120
    clamped.dispatchEvent(new Event('scroll'))
    const afterWheel = clamped.getAttribute('data-lf-open')
    window.__DSH_BUBBLE_FOLD__.revealAt(clamped)
    result.clamped.openedByScroll = afterWheel !== beforeOpen
    result.clamped.openedByReveal = clamped.getAttribute('data-lf-open') !== beforeOpen
  }
  // The reveal half for our own folds: the browser fires beforematch on the row it
  // matched, and the whole block has to come back — not just that one row.
  if (selfFolded) {
    const marked = [...document.querySelectorAll('[data-lf-step-folded]')]
    selfFolded.dispatchEvent(new Event('beforematch'))
    result.selfFolded.afterBeforeMatch = {
      rowsInBlock: marked.length,
      stillHidden: marked.filter((row) => row.hasAttribute('hidden')).length,
      stillMarked: marked.filter((row) => row.hasAttribute('data-lf-step-folded')).length
    }
  }
  return result
})()`), null, 2))

// One setting decides the text of all three controls; with it on, each control
// must be ONE layer (the old pill-wrapping-a-circle look is the bug being fixed).
console.log('text    :', JSON.stringify(await evaluate(`(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const primaries = [...document.querySelectorAll('[data-lf-step-all]')].filter((b) => !b.hidden)
  const line = primaries[primaries.length - 1]?.closest('[data-lf-step-line]')
  if (!line) return { checked: false }
  // 展开所有步骤 only exists while the Turn is spread out; get there first.
  const primary = line.querySelector('[data-lf-step-all]')
  if (line.querySelector('[data-lf-step-every]').hidden) { primary.click(); await frame() }
  const buttons = ['data-lf-step-toggle', 'data-lf-step-all', 'data-lf-step-every'].map((attr) => line.querySelector('[' + attr + ']'))
  window.__DSH_BUBBLE_FOLD__.update({ stepLabels: true })
  await frame()
  const on = buttons.map((button) => {
    const icon = button.querySelector('[data-lf-icon]')
    const iconStyle = getComputedStyle(icon)
    const buttonStyle = getComputedStyle(button)
    return {
      text: (button.querySelector('span:not([data-lf-icon])')?.textContent) ?? '',
      buttonBorder: buttonStyle.borderTopWidth,
      iconBorder: iconStyle.borderTopWidth,
      iconShadow: iconStyle.boxShadow,
      nestedChrome: iconStyle.borderTopWidth !== '0px' && buttonStyle.borderTopWidth !== '0px'
    }
  })
  window.__DSH_BUBBLE_FOLD__.update({ stepLabels: false })
  await frame()
  const off = buttons.map((button) => ({
    attr: button.getAttribute('data-lf-text') ?? null,
    iconBorder: getComputedStyle(button.querySelector('[data-lf-icon]')).borderTopWidth
  }))
  return { on, off }
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
