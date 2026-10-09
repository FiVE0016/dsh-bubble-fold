// The find panel that lives in the RIGHT sidebar, as a tab of its own: the right
// column is where the reader's auxiliary panels already are, and it opens beside
// the conversation instead of replacing it.
//
// The tab system wants three registrations sharing one id (the shape the shipped
// context/schedule panels use): the tab type, the panel body, and the title chip.
//
// The search engine is the DOM-layer controller's `search`/`revealAt`: folded
// content is always in the DOM, so a hit inside a folded message or step block
// is found and then revealed by unfolding exactly what hides it.

export function createFindPanel(React, api) {
  const h = React.createElement

  /** The tab's chip text. */
  function Title() {
    return h('span', { 'data-lf-find-chip': '1' }, '查找')
  }

  function Panel() {
    const [query, setQuery] = React.useState('')
    const [hits, setHits] = React.useState([])
    const [active, setActive] = React.useState(0)
    const inputRef = React.useRef?.(null)
    const jumpRef = React.useRef?.(() => {})

    const run = (next) => {
      setQuery(next)
      const found = api.search(next)
      setHits(found)
      setActive(found.length > 0 ? 0 : -1)
    }
    const jump = (index) => {
      const hit = hits[index]
      if (!hit) return
      setActive(index)
      api.revealAt(hit.element)
    }
    jumpRef.current = jump

    // Focus the input whenever the panel opens (keyboard route included).
    React.useEffect(() => {
      api.onFindPanelMounted?.(() => {
        const input = inputRef.current
        if (input && typeof input.focus === 'function') input.focus()
      })
    }, [])

    return h('div', { 'data-lf-find': '1' },
      h('div', { 'data-lf-find-head': '1' },
        h('input', {
          ref: inputRef,
          type: 'text',
          placeholder: '搜索本会话（含折叠内容）',
          value: query,
          onChange: (event) => run(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              if (event.shiftKey) jump(Math.max(0, active - 1))
              else jump(Math.min(hits.length - 1, active + 1))
            } else if (event.key === 'Escape') {
              run('')
            }
          }
        }),
        h('span', { 'data-lf-find-count': '1' }, query ? `${active + 1} / ${hits.length}` : '')),
      h('div', { 'data-lf-find-list': '1' },
        hits.length === 0 && query !== ''
          ? h('div', { 'data-lf-find-empty': '1' }, '没有匹配。折叠起来的内容也会被搜索。')
          : hits.map((hit, index) => h('button', {
            key: `${hit.kind}:${index}`,
            type: 'button',
            'data-lf-find-row': '1',
            'data-lf-find-active': index === active ? '1' : '0',
            title: hit.kind === 'message' ? '跳到这条消息' : '跳到这一步',
            onClick: () => jump(index)
          }, h('span', { 'data-lf-find-kind': '1' }, hit.kind === 'message' ? '消息' : '步骤'),
          h('span', { 'data-lf-find-snippet': '1' }, hit.snippet)))))
  }

  return { Panel, Title }
}
