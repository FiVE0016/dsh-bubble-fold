// DSH client-plugin entry. Built into ../client.js by scripts/build.mjs.
//
// The host calls `registration.factory(require)` with ITS OWN resolver, so:
//
//   1. Keep the `require` parameter and use it for platform modules (`react`).
//      Do not fall back to `window.__ModuleLoader__.require` — it does not exist
//      during activation, and the plugin then dies with
//      "[dsh-bubble-fold] host module unavailable: react".
//   2. Never hand this bundle's own specifiers to that resolver: the host module
//      table has never heard of "./src/browser.js", and asking it fails with
//      `client-modules: require("./src/browser.js") missed the module table`,
//      which the desktop app reports as a failed application boot.
//
// So: local modules come from the wrapper's MODULES registry (also exposed on
// window.__DSH_BUBBLE_FOLD_MODULES__ for console use); everything else goes to
// the resolver the host passes in.
//
// `dsh.client.immediately: true` in package.json is what puts this row in the
// boot graph — a DOM-only plugin registers no slot, so nothing would ever
// request it and the bundle would never execute without it.
window.__ModuleLoader__.load({
  id: 'dsh-bubble-fold',
  factory: (require) => {
    const React = require('react')
    const local = window.__DSH_BUBBLE_FOLD_MODULES__ ?? {}
    const { start } = local['./src/browser.js']
    const fold = local['./src/fold.js']

    // Derive every browser global from the document's own view. Reading bare
    // `getComputedStyle` / `localStorage` globals only works inside a test
    // harness: in the page `getComputedStyle` is brand-checked, so an unbound
    // reference throws "Illegal invocation" the first time layout is measured.
    const view = document.defaultView ?? window

    let controller = null

    const dispose = () => {
      controller?.dispose()
      controller = null
      // Leave no trace of the console handle once the row is gone.
      delete window.__DSH_BUBBLE_FOLD__
    }

    return {
      name: 'dsh-bubble-fold',
      inject: [],
      apply() {
        if (controller !== null) return
        try {
          controller = start({
            document,
            localStorage: view.localStorage,
            getComputedStyle: view.getComputedStyle.bind(view),
            requestAnimationFrame: view.requestAnimationFrame.bind(view),
            setTimeout: view.setTimeout.bind(view),
            clearTimeout: view.clearTimeout.bind(view),
            MutationObserver: view.MutationObserver,
            HTMLElement: view.HTMLElement,
            Element: view.Element,
            addEventListener: view.addEventListener.bind(view),
            removeEventListener: view.removeEventListener.bind(view),
            __DSH_BUBBLE_FOLD_MODULES__: { fold }
          }, React)
        } catch (error) {
          // A failed fold must never take the conversation down with it.
          console.warn('[dsh-bubble-fold] 启动失败，气泡折叠已停用：', error)
          controller = null
        }

        // Console handle: __DSH_BUBBLE_FOLD__.status / .settings() / .stats()
        window.__DSH_BUBBLE_FOLD__ = {
          plugin: 'dsh-bubble-fold',
          status: controller ? 'running' : 'failed',
          rescan: () => controller?.rescan(),
          settings: () => controller?.settings(),
          stats: () => controller?.stats(),
          update: (patch) => controller?.update(patch),
          setHeight: (value) => controller?.setHeight(value),
          resetHeight: () => controller?.resetHeight(),
          dispose
        }

        return dispose
      },
      dispose
    }
  }
})
