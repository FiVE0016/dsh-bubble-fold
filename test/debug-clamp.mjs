// Minimal repro: does the first scan clamp the message and un-hide its row?
import { start } from '../src/browser.js'
import * as fold from '../src/fold.js'

class E {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = { ...attrs }
    this.children = []
    this.parentElement = null
    this.parentNode = null
    this.style = { values: {}, setProperty: (k, v) => { this.style.values[k] = String(v) }, removeProperty: (k) => { delete this.style.values[k] } }
    this.textContent = ''
    this.hidden = false
    this.disabled = false
    this.type = ''
    this.scrollHeight = 0
    this.rectHeight = 0
    this.rectTop = 0
    this.isConnected = true
  }
  hasAttribute(n) { return Object.hasOwn(this.attrs, n) }
  getAttribute(n) { return Object.hasOwn(this.attrs, n) ? this.attrs[n] : null }
  setAttribute(n, v) { this.attrs[n] = String(v) }
  removeAttribute(n) { delete this.attrs[n] }
  appendChild(c) { c.parentElement = this; c.parentNode = this; c.isConnected = true; this.children.push(c); return c }
  append(...n) { n.forEach((x) => this.appendChild(x)) }
  insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentElement = this; c.parentNode = this; c.isConnected = true; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c }
  remove() { const i = this.parentElement?.children.indexOf(this) ?? -1; if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; this.parentNode = null; this.isConnected = false }
  get firstElementChild() { return this.children[0] ?? null }
  getBoundingClientRect() {
    let height = this.rectHeight
    const wrapper = this.parentElement
    if (this.hasAttribute('data-lf-clamped') && this.getAttribute('data-lf-open') !== '1' && wrapper) {
      const budget = Number.parseFloat(wrapper.style.values['--lf-clamp-height'])
      if (Number.isFinite(budget)) height = Math.min(height, budget)
    }
    return { top: this.rectTop, bottom: this.rectTop + height, height, width: 700 }
  }
  querySelectorAll(s) { return collect(this, s) }
  querySelector(s) { return collect(this, s)[0] ?? null }
  closest(s) { return climb(this, s) }
  addEventListener(t, h) { (this.h = this.h ?? {})[t] = h }
  click() { this.h?.click?.({ target: this }) }
}

const parse = (sel) => {
  const m = /^([a-zA-Z]+)?((?:\[[^\]]*\])*)$/.exec(sel.trim())
  if (!m) return null
  return { tag: m[1]?.toUpperCase() ?? null, attrs: [...m[2].matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)].map(([, n, v]) => ({ n, v })) }
}
const one = (el, sel) => {
  const p = parse(sel)
  if (!p) return false
  if (p.tag && el.tagName !== p.tag) return false
  return p.attrs.every(({ n, v }) => (v === undefined ? el.hasAttribute(n) : el.getAttribute(n) === v))
}
const matches = (el, sel) => sel.split(',').some((g) => {
  const parts = g.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return false
  if (!one(el, parts[parts.length - 1])) return false
  let node = el.parentElement
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let found = false
    while (node) { if (one(node, parts[i])) { found = true; node = node.parentElement; break } node = node.parentElement }
    if (!found) return false
  }
  return true
})
const climb = (el, sel) => { let n = el; while (n) { if (matches(n, sel)) return n; n = n.parentElement } return null }
const collect = (root, sel, out = []) => { for (const c of root.children) { if (matches(c, sel)) out.push(c); collect(c, sel, out) } return out }

const html = new E('html')
const head = html.appendChild(new E('head'))
const body = html.appendChild(new E('body'))
const scroll = body.appendChild(new E('div', { 'data-conversation-scroll': '' }))
// Give the flows realistic vertical positions: first message at the top.
const user = () => {
  const a = scroll.appendChild(new E('div', { 'data-chat-flow-kind': 'user', 'data-chat-anchor-key': 'u1' }))
  const row = a.appendChild(new E('div'))
  const stack = row.appendChild(new E('div'))
  const bubble = stack.appendChild(new E('div'))
  bubble.scrollHeight = 600
  bubble.rectHeight = 600
  bubble.rectTop = 0
  return { a, bubble }
}
const { a, bubble } = user()

const win = {
  document: {
    documentElement: html, head, body, activeElement: null,
    createElement: (t) => new E(t),
    getElementById: (id) => collect(html, '[id="' + id + '"]')[0] ?? null,
    querySelectorAll: (s) => collect(html, s),
    querySelector: (s) => collect(html, s)[0] ?? null,
    addEventListener() {}, removeEventListener() {}
  },
  localStorage: { store: new Map(), getItem(k) { return this.store.get(k) ?? null }, setItem(k, v) { this.store.set(k, String(v)) } },
  getComputedStyle: () => ({ lineHeight: '22px', fontSize: '14px', backgroundColor: 'rgb(255,255,255)', getPropertyValue: () => '0px' }),
  requestAnimationFrame: (fn) => { fn(); return 1 },
  setTimeout: (fn) => { fn(); return 1 },
  clearTimeout() {}, addEventListener() {}, removeEventListener() {},
  MutationObserver: class { observe() {} disconnect() {} },
  HTMLElement: E, Element: E,
  innerHeight: 800,
  performance: { now: () => Date.now() },
  __DSH_BUBBLE_FOLD_MODULES__: { fold }
}

const controller = start(win, {})
controller.rescan()

const row = a.querySelector('[data-lf-tail="user"]')
console.log('bubble data-lf-clamped :', bubble.getAttribute('data-lf-clamped'))
console.log('bubble parent data-lf-body:', bubble.parentElement?.getAttribute('data-lf-body'))
console.log('budget variable        :', bubble.parentElement?.style.values['--lf-clamp-height'])
console.log('tail present           :', Boolean(row))
console.log('tail hidden attr       :', row?.hasAttribute('hidden'))
console.log('tail hidden property   :', row?.hidden)
console.log('toggle text            :', JSON.stringify(row?.children?.[0]?.textContent))
console.log('stats                  :', JSON.stringify(controller.stats?.()))
