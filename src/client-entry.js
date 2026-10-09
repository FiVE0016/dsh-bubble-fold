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
    const { createPanel } = local['./src/settings-panel.js']
    const { createFindPanel } = local['./src/find-panel.js']

    /** The find tab's identity in the right sidebar: one id for all three parts. */
    const FIND_TAB_ID = 'bubble-fold-find'
    /** True only once the tab type AND its body really registered. */
    let findTabRegistered = false

    // Derive every browser global from the document's own view. Reading bare
    // `getComputedStyle` / `localStorage` globals only works inside a test
    // harness: in the page `getComputedStyle` is brand-checked, so an unbound
    // reference throws "Illegal invocation" the first time layout is measured.
    const view = document.defaultView ?? window

    let controller = null
    let panelOff = null
    let findTabOff = null
    let findTitleOff = null
    let findPanelOff = null
    /** The find panel asks for focus when it opens; the keydown route sets it. */
    let focusFindInput = null
    /** Two-way sync with the host's right-sidebar width; null when unsupported. */
    let rightbar = null

    // Stable api object for the settings tab and the find panel: the components
    // mount on first selection (possibly before or after a restart of the fold),
    // so they reach the controller through indirection, never a captured ref.
    const api = {
      settings: () => controller?.settings() ?? null,
      update: (patch) => controller?.update(patch),
      subscribe: (fn) => controller?.subscribe(fn) ?? (() => {}),
      search: (query) => controller?.search(query) ?? [],
      revealAt: (element) => controller?.revealAt(element),
      // The composer height is a host-CSS knob, not a plugin setting: the settings
      // page reads its range/current value here instead of from `settings()`.
      composer: () => controller?.composer() ?? null,
      setHeight: (value) => controller?.setHeight(value),
      resetHeight: () => controller?.resetHeight(),
      // Right-sidebar width: the percentage lives in the settings, the px in the
      // host's layout store. setRightbarRatio applies it; rightbar() reports what
      // the host actually shows, so the page can say "不支持" on older hosts.
      setRightbarRatio: (ratio) => rightbar?.setRatio(ratio),
      rightbar: () => rightbar?.info() ?? null,
      onFindPanelMounted: (fn) => { focusFindInput = fn }
    }

    const { Panel: FindPanel, Title: FindTitle } = createFindPanel(React, api)

    // Reassigned by apply() to also release the Ctrl+F listener once the
    // desktop key route is installed.
    let disposed = false
    let dispose = () => {
      disposed = true
      panelOff?.()
      findTabOff?.()
      findTitleOff?.()
      findPanelOff?.()
      rightbar?.dispose()
      panelOff = null
      findTabOff = null
      findTitleOff = null
      findPanelOff = null
      rightbar = null
      focusFindInput = null
      controller?.dispose()
      controller = null
      // Leave no trace of the console handle once the row is gone.
      delete window.__DSH_BUBBLE_FOLD__
    }

    /**
     * Two-way sync between the host's right-sidebar width (px) and the plugin
     * setting `rightbarRatio` (percent of the frame).
     *
     * Verified against the host's own code: `ctx.layout` is a LayoutController
     * whose fields are `panels` (the real store actions), `hasMainPanel`,
     * `panelInfo` (a {getSnapshot,subscribe} facade for the CENTRAL panel only) and
     * `navigation`. There is NO `layoutInfo` and NO `layout.setRightbar` — the
     * width is written through `layout.panels.setRightbar(px)` and can only be
     * READ back from the DOM (the AppFrame's resolved grid tracks), which is also
     * what makes the manual drag observable. Everything is probed defensively, so
     * a host without these internals simply loses this control.
     */
    const makeRightbarControl = (layout, view, doc, getSettings, updateSettings) => {
      let disposed = false
      const panels = layout?.panels ?? null
      const setRightbar = typeof panels?.setRightbar === 'function' ? panels.setRightbar
        : (typeof layout?.setRightbar === 'function' ? layout.setRightbar : null)
      const viewportOf = () => view?.innerWidth || 0
      /**
       * The AppFrame is the grid owning the three columns (sidebar | conversation |
       * right panel). Found by walking up from something that always exists — the
       * composer seat, else any flow row — instead of by a class name or an
       * attribute that is only present in some states.
       */
      const frameOf = () => {
        if (!doc || typeof doc.querySelector !== 'function') return null
        let node = doc.querySelector('[data-composer-seat]') ?? doc.querySelector('[data-chat-flow-kind]') ?? doc.body
        while (node && node !== doc.documentElement) {
          try {
            if (view.getComputedStyle(node).display === 'grid') return node
          } catch { /* not inspectable */ }
          node = node.parentElement
        }
        return null
      }
      /** Right panel width in px, read from the frame's resolved grid tracks. */
      const rightbarPx = () => {
        const frame = frameOf()
        if (!frame) return 0
        let tracks
        try {
          tracks = view.getComputedStyle(frame).gridTemplateColumns
        } catch {
          return 0
        }
        const sizes = String(tracks).split(' ').map((part) => Number.parseFloat(part)).filter((px) => Number.isFinite(px))
        return sizes.length >= 2 ? sizes[sizes.length - 1] : 0
      }
      const ratioNow = () => {
        const viewport = viewportOf()
        const px = rightbarPx()
        if (!(viewport > 0) || !(px > 0)) return null
        return Math.round((px / viewport) * 100)
      }
      // Until our stored value has been applied, observations must not overwrite it:
      // the host reports its own 45% default at startup, and writing that back would
      // silently replace the reader's choice before it ever reached the store.
      let settled = false
      let lastRatio = null
      const observe = () => {
        if (!settled) return
        const ratio = ratioNow()
        if (ratio === null || ratio === lastRatio) return
        lastRatio = ratio
        if (getSettings()?.rightbarRatio !== ratio) updateSettings({ rightbarRatio: ratio })
      }
      const applyRatio = (ratio) => {
        if (!setRightbar || !(ratio > 0)) return false
        const viewport = viewportOf()
        if (!(viewport > 0)) return false
        try {
          setRightbar(Math.round(viewport * ratio / 100))
          return true
        } catch {
          return false
        }
      }
      // The frame is not measurable at activation time, and the controller (which
      // owns the settings) is created after this control, so the first attempt is
      // deferred and every failed attempt is retried.
      const timers = []
      const applyStored = (attempt) => {
        if (disposed) return
        const ratio = getSettings()?.rightbarRatio
        const applied = ratio > 0 ? applyRatio(ratio) : false
        const now = ratioNow()
        if (applied && now !== null && Math.abs(now - ratio) <= 1) {
          settled = true
          return
        }
        if (attempt < 8) {
          timers.push(view.setTimeout(() => applyStored(attempt + 1), 300))
          return
        }
        settled = !!setRightbar
      }
      timers.push(view.setTimeout(() => applyStored(0), 0))

      // A drag changes the frame's inline grid template; a window resize changes the
      // frame. Both are read from the DOM, since the store exposes no getter.
      let observer = null
      try {
        const frame = frameOf()
        if (frame && typeof view.MutationObserver === 'function') {
          observer = new view.MutationObserver(() => observe())
          observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
        }
      } catch { observer = null }
      const onResize = () => { if (!disposed) view.setTimeout(observe, 60) }
      try { view.addEventListener('resize', onResize) } catch { /* no window events */ }

      return {
        setRatio(ratio) {
          const clamped = Math.max(30, Math.min(70, Math.round(Number(ratio) || 45)))
          updateSettings({ rightbarRatio: clamped })
          settled = false
          applyRatio(clamped)
          lastRatio = null
          view.setTimeout(() => { settled = true; observe() }, 120)
        },
        info() {
          return { supported: !!setRightbar, ratio: ratioNow(), viewport: viewportOf() }
        },
        dispose() {
          disposed = true
          observer?.disconnect()
          observer = null
          for (const timer of timers) view.clearTimeout(timer)
          try { view.removeEventListener('resize', onResize) } catch { /* ignore */ }
        }
      }
    }

    const plugin = {
      name: 'dsh-bubble-fold',
      inject: ['slots'],
      /**
       * The row is `dsh.client.immediately`, i.e. part of the boot graph: if this
       * throws, the HOST fails to start and the reader gets a "cannot start" dialog
       * instead of an app. So nothing may escape — every optional feature degrades
       * to "not there", the DOM fold keeps working, and the app always comes up.
       */
      apply(ctx) {
        try {
          return plugin.applyRow(ctx)
        } catch (error) {
          console.warn('[dsh-bubble-fold] 激活时出错，本插件已降级停用（应用不受影响）：', error)
          return dispose
        }
      },
      applyRow(ctx) {
        if (controller !== null) return
        try {
          // The layout service belongs to the shell plugin and may still be
          // activating when this row runs, exactly like sidebarRightTabs — asking
          // once would silently disable the width control for the whole session.
          // So keep asking for a few seconds before giving up.
          const setupRightbar = (attempt) => {
            if (disposed || rightbar) return
            const layout = ctx?.get?.('layout') ?? null
            if (layout) {
              rightbar = makeRightbarControl(layout, view, document, () => controller?.settings(), (patch) => controller?.update(patch))
              return
            }
            if (attempt < 10) view.setTimeout(() => setupRightbar(attempt + 1), 300)
            else console.warn('[dsh-bubble-fold] 此宿主未暴露 layout 服务，右侧栏占比不可用')
          }
          setupRightbar(0)
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
            // Stable identity for the floating panel: the real control may be built
            // a moment later (the layout service can activate after this row).
            rightbar: {
              setRatio: (ratio) => rightbar?.setRatio(ratio),
              info: () => rightbar?.info() ?? null
            },
            __DSH_BUBBLE_FOLD_MODULES__: { fold }
          }, React)
        } catch (error) {
          // A failed fold must never take the conversation down with it.
          console.warn('[dsh-bubble-fold] 启动失败，气泡折叠已停用：', error)
          controller = null
        }

        // The settings page lives in the host's Plugins settings section. A
        // missing slots service (an older host) just means no settings tab and no
        // find tab: the fold itself is DOM-only and keeps working.
        const slots = ctx?.slots
        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          try {
            panelOff = slots.inject('settings.plugins.tab', () => slots.register({
              name: 'settings.plugins.tab',
              id: 'bubble-fold',
              order: 20,
              label: 'UI 美化',
              inject: () => ({ api })
            }, createPanel(React, api)))
          } catch (error) {
            console.warn('[dsh-bubble-fold] 设置页注册失败，仅浮层面板可用：', error)
            panelOff = null
          }
        }

        // The find panel is a tab of the RIGHT sidebar (the column the reader
        // already keeps 上下文/文件 in). A tab needs three registrations under one
        // id — the tab type, its body, and its chip — exactly the shape the
        // shipped context and schedule panels use. That registry may still be
        // activating when we are (it belongs to the right-bar package), so keep
        // asking for a few seconds instead of giving up on the first miss.
        const registerFindTab = () => {
          // Only ctx.get() may be used for a service this plugin does not declare:
          // a property read on the restricted context THROWS for unknown names, and
          // a throwing boot row takes the whole app down with it.
          let tabs = null
          try {
            tabs = ctx?.get?.('sidebarRightTabs') ?? null
          } catch {
            tabs = null
          }
          if (!slots || !tabs || typeof tabs.register !== 'function') return false
          try {
            findTabOff = tabs.register({ id: FIND_TAB_ID, kind: FIND_TAB_ID, title: () => '查找' })
            findPanelOff = slots.inject('sidebar.right.pane.tab', () => slots.register({
              name: 'sidebar.right.pane.tab',
              key: FIND_TAB_ID,
              inject: () => ({ api })
            }, FindPanel))
            findTitleOff = slots.inject('sidebar.right.pane.tab.title', () => slots.register({
              name: 'sidebar.right.pane.tab.title',
              key: FIND_TAB_ID
            }, FindTitle))
            findTabRegistered = true
            return true
          } catch (error) {
            console.warn('[dsh-bubble-fold] 右栏查找注册失败：', error)
            findTabOff?.()
            findPanelOff?.()
            findTitleOff?.()
            findTabOff = null
            findPanelOff = null
            findTitleOff = null
            findTabRegistered = false
            return true
          }
        }
        if (!registerFindTab()) {
          let tries = 0
          const retryFindTab = () => {
            if (findTabRegistered || disposed) return
            let done = false
            try {
              done = registerFindTab()
            } catch (error) {
              // Never let an optional feature reach the host as a failed entry.
              console.warn('[dsh-bubble-fold] 右栏查找注册出错，已放弃：', error)
              done = true
            }
            if (done) return
            if (++tries >= 10) {
              // Nothing to open later, so Ctrl+F must not touch the layout at all:
              // opening the column without a tab leaves the reader a blank pane.
              console.warn('[dsh-bubble-fold] 此宿主未暴露 sidebarRightTabs，右栏「查找」不可用')
              return
            }
            view.setTimeout(retryFindTab, 500)
          }
          retryFindTab()
        }

        // Ctrl+F opens the find tab — but only where the platform has no find of
        // its own. The desktop app has none (verified: no findInPage), while a
        // real browser's Ctrl+F already reaches folded content thanks to the
        // until-found work; hijacking it there would be a downgrade.
        const desktopApp = /Electron\//.test(view.navigator?.userAgent ?? '')
        if (desktopApp) {
          const onFindKey = (event) => {
            if (event.key !== 'f' || !event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            if (!findTabRegistered) {
              console.warn('[dsh-bubble-fold] 查找面板未注册，Ctrl+F 不做任何事（不会打开空面板）')
              return
            }
            let right = null
            try {
              right = ctx?.get?.('sidebarRight') ?? null
            } catch {
              right = null
            }
            let opened = false
            if (right && typeof right.openTab === 'function') {
              try {
                right.openTab(FIND_TAB_ID)
                opened = true
              } catch {
                // A root-scoped face may refuse: the column is opened instead.
              }
            }
            if (!opened) {
              const layout = ctx?.get?.('layout')
              try { layout?.openRightbar?.(true, false) } catch { /* column cannot fit */ }
            }
            // The panel mounts on first open and asks for focus itself.
            view.setTimeout(() => focusFindInput?.(), 80)
          }
          view.addEventListener('keydown', onFindKey, true)
          const prevDispose = dispose
          dispose = () => {
            view.removeEventListener('keydown', onFindKey, true)
            prevDispose()
          }
        }

        // Console handle: __DSH_BUBBLE_FOLD__.status / .settings() / .stats()
        window.__DSH_BUBBLE_FOLD__ = {
          plugin: 'dsh-bubble-fold',
          status: controller ? 'running' : 'failed',
          rescan: () => controller?.rescan(),
          settings: () => controller?.settings(),
          stats: () => controller?.stats(),
          update: (patch) => controller?.update(patch),
          search: (query) => controller?.search(query),
          revealAt: (element) => controller?.revealAt(element),
          setHeight: (value) => controller?.setHeight(value),
          resetHeight: () => controller?.resetHeight(),
          setRightbarRatio: (ratio) => rightbar?.setRatio(ratio),
          rightbar: () => rightbar?.info() ?? null,
          // Diagnostic for the right-sidebar width feature: dumps the host layout
          // service's real shape, so a mis-synced width can be reported precisely.
          layoutDebug: () => {
            const layout = ctx?.get?.('layout') ?? null
            if (!layout) return { layout: null }
            const panels = layout.panels ?? null
            return {
              keys: Object.keys(layout),
              panelKeys: panels ? Object.keys(panels).slice(0, 40) : null,
              setRightbar: typeof panels?.setRightbar,
              rightbar: rightbar?.info() ?? null
            }
          },
          /**
           * Live experiment for the right-bar width: read the frame's grid tracks,
           * call the setter, read them again after two frames. It answers "does this
           * host honour the call, and where does the width actually live?" without a
           * restart cycle.
           */
          layoutTry: async (ratio = 60) => {
            const layout = ctx?.get?.('layout') ?? null
            const panels = layout?.panels ?? null
            const frameOf = () => {
              let node = document.querySelector('[data-composer-seat]') ?? document.querySelector('[data-chat-flow-kind]')
              while (node && node !== document.documentElement) {
                if (getComputedStyle(node).display === 'grid') return node
                node = node.parentElement
              }
              for (const el of document.querySelectorAll('[data-rightbar-fullscreen], [data-rightbar-collapsed], [data-rightbar-instant]')) {
                if (getComputedStyle(el).display === 'grid') return el
              }
              return null
            }
            const frame = frameOf()
            const read = () => ({
              frameFound: !!frame,
              tracks: frame ? getComputedStyle(frame).gridTemplateColumns : null,
              viewport: window.innerWidth,
              collapsed: frame ? frame.hasAttribute('data-rightbar-collapsed') : null,
              fullscreen: frame ? frame.hasAttribute('data-rightbar-fullscreen') : null
            })
            const before = read()
            const px = Math.round(window.innerWidth * ratio / 100)
            let error = null
            try {
              panels?.setRightbar?.(px)
            } catch (caught) {
              error = String(caught)
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            return {
              keys: layout ? Object.keys(layout) : null,
              panelKeys: panels ? Object.keys(panels).slice(0, 40) : null,
              setRightbar: typeof panels?.setRightbar,
              ratio,
              px,
              error,
              before,
              after: read()
            }
          },
          dispose
        }

        return dispose
      },
      dispose
    }

    return plugin
  }
})
