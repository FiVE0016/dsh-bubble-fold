// Plain-Node checks for the pure fold logic. No framework, no DOM:
// run with `node test/fold.test.mjs` (or `npm test`).
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  LIMITS,
  MODE_ALWAYS,
  MODE_OVERFLOW,
  clampHeightFor,
  gapFor,
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
  assert.equal(clampHeightFor(10, 22), 220)
})
test('is exactly the line budget — the control row is not part of the box', () => {
  assert.equal(clampHeightFor(3, 22), 66)
  assert.ok(clampHeightFor(3, 22) < clampHeightFor(3, 22) + gapFor(34))
})
test('is zero for degenerate input', () => {
  assert.equal(clampHeightFor(0, 22), 0)
  assert.equal(clampHeightFor(4, 0), 0)
})

console.log('gapFor')
test('passes the gap through and floors it at zero', () => {
  assert.equal(gapFor(34), 34)
  assert.equal(gapFor(0), 0)
  assert.equal(gapFor(-100), 0)
  assert.equal(gapFor('nonsense'), 0)
})
test('the default gap is small: it only separates the message from its control', () => {
  assert.equal(gapFor(DEFAULT_SETTINGS.extraPx), DEFAULT_SETTINGS.extraPx)
  assert.ok(DEFAULT_SETTINGS.extraPx <= 16, 'a gap larger than the pill starts to look like a hole')
})

console.log('shouldClamp')
const base = { sideEnabled: true, streaming: false, alreadyWrapped: false, lineHeight: 22, lines: 6, collapseAll: false, mode: MODE_OVERFLOW }
test('collapses content over the line budget', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 400 }), true)
})
test('leaves short content alone in overflow mode', () => {
  assert.equal(shouldClamp({ ...base, contentPx: 100 }), false)
  // 6 lines of 22px is the whole box: at the budget the message still fits.
  assert.equal(shouldClamp({ ...base, contentPx: 132 }), false)
  assert.equal(shouldClamp({ ...base, contentPx: 141 }), true)
})
test('collapses anything longer than the box once collapseAll is on', () => {
  const collapsed = { ...base, collapseAll: true, lines: 3, mode: MODE_ALWAYS }
  assert.equal(shouldClamp({ ...collapsed, contentPx: 200 }), true)
  // Three lines of 22px is the whole box; the 3px over it already counts.
  assert.equal(shouldClamp({ ...collapsed, contentPx: 66 }), false)
  assert.equal(shouldClamp({ ...collapsed, contentPx: 90 }), true)
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
