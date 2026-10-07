// Plain-Node checks for the pure fold logic. No framework, no DOM:
// run with `node test/fold.test.mjs` (or `npm test`).
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  LIMITS,
  MODE_ALWAYS,
  MODE_OVERFLOW,
  clampHeightFor,
  hiddenLineLabel,
  normalizeSettings,
  settingsForSide,
  shouldClamp
} from '../src/fold.js'

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

console.log('normalizeSettings')
test('falls back to defaults for junk input', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings('nonsense'), DEFAULT_SETTINGS)
})
test('clamps out-of-range numbers instead of trusting them', () => {
  const settings = normalizeSettings({ userLines: 0, assistantLines: 9999, extraPx: -50, collapsedLines: 999 })
  assert.equal(settings.userLines, LIMITS.minLines)
  assert.equal(settings.assistantLines, LIMITS.maxLines)
  assert.equal(settings.extraPx, LIMITS.minExtraPx)
  assert.equal(settings.collapsedLines, LIMITS.maxDefaultCollapsedLines)
})
test('parses numeric strings from the settings inputs', () => {
  assert.equal(normalizeSettings({ userLines: '12' }).userLines, 12)
})
test('keeps booleans, ignores non-booleans', () => {
  const settings = normalizeSettings({ enabled: false, collapseAll: 'yes', workStepButtons: false })
  assert.equal(settings.enabled, false)
  assert.equal(settings.collapseAll, DEFAULT_SETTINGS.collapseAll)
  assert.equal(settings.workStepButtons, false)
})
test('the reading-focused defaults are on and can be turned off', () => {
  // The newest turn stays open and steps start folded unless the reader opts out.
  assert.equal(DEFAULT_SETTINGS.keepLatestOpen, true)
  assert.equal(DEFAULT_SETTINGS.foldAllSteps, true)
  assert.deepEqual(
    { keepLatestOpen: normalizeSettings({ keepLatestOpen: false }).keepLatestOpen, foldAllSteps: normalizeSettings({ foldAllSteps: false }).foldAllSteps },
    { keepLatestOpen: false, foldAllSteps: false }
  )
})
test('rounds fractional line budgets', () => {
  assert.equal(normalizeSettings({ userLines: 7.6 }).userLines, 8)
})

console.log('settingsForSide')
test('splits the two sides independently', () => {
  const settings = normalizeSettings({ userLines: 4, assistantLines: 20, userEnabled: false })
  assert.deepEqual(settingsForSide(settings, 'user'), { enabled: false, lines: 4 })
  assert.deepEqual(settingsForSide(settings, 'assistant'), { enabled: true, lines: 20 })
})

console.log('clampHeightFor')
test('multiplies the budget by the resolved line height', () => {
  assert.equal(clampHeightFor(10, 22, 0), 220)
})
test('adds the fade/button allowance', () => {
  assert.equal(clampHeightFor(3, 22, 34), 100)
})
test('is zero for degenerate input', () => {
  assert.equal(clampHeightFor(0, 22, 34), 0)
  assert.equal(clampHeightFor(4, 0, 34), 0)
})
test('never returns a negative height', () => {
  assert.equal(clampHeightFor(4, 22, -100), 88)
})

console.log('shouldClamp')
const base = { sideEnabled: true, streaming: false, alreadyWrapped: false, lineHeight: 22, extraPx: 34, lines: 6, collapseAll: false, mode: MODE_OVERFLOW }
test('collapses content over the line budget', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 400 }), true)
})
test('leaves short content alone in overflow mode', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 100 }), false)
  assert.equal(shouldClamp({ ...base, contentPx: 166 }), false)
})
test('collapses anything longer than the box once collapseAll is on', () => {
  const collapsed = { ...base, collapseAll: true, lines: 3, mode: MODE_ALWAYS }
  assert.equal(shouldClamp({ ...collapsed, contentPx: 200 }), true)
  assert.equal(shouldClamp({ ...collapsed, contentPx: 90 }), false)
})
test('respects the per-side switch', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 400, sideEnabled: false }), false)
})
test('never clamps a streaming reply', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 400, streaming: true }), false)
})
test('does not double-wrap an already clamped body', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 400, alreadyWrapped: true }), false)
})
test('refuses to act on unmeasured content', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 0 }), false)
  assert.equal(shouldClamp({ ...base, contentPx: 400, lineHeight: 0 }), false)
})

console.log('hiddenLineLabel')
test('reports how much is folded away', () => {
  assert.equal(hiddenLineLabel(440, 220, 22), '还有 10 行')
})
test('stays quiet when nothing is hidden', () => {
  assert.equal(hiddenLineLabel(200, 220, 22), '')
  assert.equal(hiddenLineLabel(440, 220, 0), '')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
