// 诊断片段：贴进浏览器 DevTools 控制台（在 DSH 页面里），把返回的 JSON 发回给我。
// 它只读 DOM，不改任何东西。
// Paste into the DSH page's DevTools console; send the returned JSON back.
(() => {
  const count = (selector) => document.querySelectorAll(selector).length
  const attrs = (element) => [...element.attributes]
    .filter((a) => a.name.startsWith('data-') || a.name === 'hidden')
    .map((a) => a.name + (a.value && a.value !== 'true' ? '=' + String(a.value).slice(0, 20) : ''))
    .join(' ')
  const chain = (element, depth = 4) => {
    const out = []
    for (let node = element, i = 0; node && i < depth; i += 1, node = node.parentElement) {
      out.push(node.tagName.toLowerCase() + (attrs(node) ? '[' + attrs(node) + ']' : ''))
    }
    return out
  }
  const firstTurnProcess = document.querySelector('[data-turn-process]')
  const firstGroup = document.querySelector('[data-step-process]')
  return JSON.stringify({
    plugin: window.__DSH_BUBBLE_FOLD__
      ? { status: window.__DSH_BUBBLE_FOLD__.status, settings: window.__DSH_BUBBLE_FOLD__.settings(), stats: window.__DSH_BUBBLE_FOLD__.stats() }
      : null,
    counts: {
      turnProcess: count('[data-turn-process]'),
      turnProcessDisabled: count('[data-turn-process][disabled]'),
      turnProcessExpanded: count('[data-turn-process][aria-expanded]'),
      stepContainers: count('[data-step-process]'),
      stepContainersInline: count('[data-step-process][data-group-expanded-mode]'),
      members: count('[data-turn-process-member]'),
      seams: count('[data-lf-step-toggle]'),
      foldedByPlugin: count('[data-lf-step-folded]')
    },
    firstTurnProcess: firstTurnProcess
      ? {
          disabled: firstTurnProcess.disabled === true,
          ariaExpanded: firstTurnProcess.getAttribute('aria-expanded'),
          dataOpen: firstTurnProcess.hasAttribute('data-open'),
          chain: chain(firstTurnProcess)
        }
      : null,
    firstStepContainer: firstGroup
      ? {
          inlineMode: firstGroup.hasAttribute('data-group-expanded-mode'),
          headerExpanded: firstGroup.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') ?? null,
          members: firstGroup.querySelectorAll('[data-turn-process-member]').length,
          chain: chain(firstGroup)
        }
      : null,
    // 步骤串和它后面那条回复的关系：折叠缝就挂在这两者之间
    siblingSample: firstTurnProcess?.parentElement
      ? [...firstTurnProcess.parentElement.children].slice(0, 30)
        .map((node, index) => index + ':' + node.tagName.toLowerCase() + '[' + attrs(node) + ']')
      : null,
    workDetailsMode: (() => {
      try {
        return Object.keys(localStorage)
          .filter((key) => /mode|detail|transcript|work/i.test(key))
          .map((key) => key + '=' + localStorage.getItem(key))
      } catch { return ['localStorage unavailable'] }
    })()
  })
})()
