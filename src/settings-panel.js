// The settings page rendered inside the host's Plugins settings section, as a
// `settings.plugins.tab` contribution. Plain React.createElement — this bundle
// has no JSX transform, and React comes from the host's own module table.
//
// The component receives one `api` prop (through the slot registration's
// `inject`): { settings(), update(patch), subscribe(fn) }. Everything else lives
// in the DOM-layer controller this bundle already runs.

export function createPanel(React, api) {
  const h = React.createElement

  function Row(props) {
    const { label, hint, children } = props
    return h('div', { 'data-lf-setting-row': '1' },
      h('div', { 'data-lf-setting-text': '1' },
        h('div', { 'data-lf-setting-label': '1' }, label),
        hint ? h('div', { 'data-lf-setting-hint': '1' }, hint) : null),
      h('div', { 'data-lf-setting-control': '1' }, children))
  }

  function Toggle(props) {
    const { checked, onChange, label } = props
    return h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': checked ? 'true' : 'false',
      'aria-label': label,
      'data-lf-switch': checked ? '1' : '0',
      onClick: () => onChange(!checked)
    }, h('span', { 'data-lf-knob': '1' }))
  }

  function NumberBox(props) {
    const { value, min, max, onChange, suffix } = props
    const [draft, setDraft] = React.useState(() => String(value))
    // Follow external writes (the floating panel can change the same value).
    React.useEffect(() => { setDraft(String(value)) }, [value])
    const commit = () => {
      const number = Number.parseInt(draft, 10)
      if (Number.isFinite(number)) onChange(Math.max(min, Math.min(max, number)))
      else setDraft(String(value))
    }
    return h('span', { 'data-lf-number': '1' },
      h('input', {
        type: 'number',
        value: draft,
        min,
        max,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => { if (event.key === 'Enter') commit() }
      }),
      suffix ? h('span', { 'data-lf-suffix': '1' }, suffix) : null)
  }

  function SettingsPanel() {
    const [settings, setSettings] = React.useState(() => api.settings())
    React.useEffect(() => api.subscribe(() => setSettings(api.settings())), [])
    if (!settings) {
      return h('div', { 'data-lf-setting-empty': '1' }, '气泡折叠未启动。')
    }
    const patch = (part) => api.update(part)
    return h('div', { 'data-lf-setting': '1' },
      h('div', { 'data-lf-setting-intro': '1' },
        '改动即时生效。输入框高度、快捷键等更多设置见对话页的 Ctrl + Shift + , 面板。'),
      h(Row, {
        label: '启用气泡折叠',
        hint: '关闭后所有折叠与控件立即消失，界面回到原生状态。'
      }, h(Toggle, {
        checked: settings.enabled,
        label: '启用气泡折叠',
        onChange: (value) => patch({ enabled: value })
      })),
      h(Row, {
        label: '折叠我的输入（行）',
        hint: '超过这个行数的历史输入会被折起。'
      }, h(NumberBox, {
        value: settings.userLines, min: 2, max: 120,
        onChange: (value) => patch({ userLines: value })
      })),
      h(Row, {
        label: '折叠助手回复（行）',
        hint: '超过这个行数的历史回复会被折起。'
      }, h(NumberBox, {
        value: settings.assistantLines, min: 2, max: 120,
        onChange: (value) => patch({ assistantLines: value })
      })),
      h(Row, {
        label: '折叠后与控件的间距 (px)',
        hint: '折叠框与下方展开/复制按钮之间的距离。'
      }, h(NumberBox, {
        value: settings.extraPx, min: 0, max: 120,
        onChange: (value) => patch({ extraPx: value })
      })),
      h(Row, {
        label: '默认只留一个按钮',
        hint: '每轮回复上方只显示「展开全部」；点开才摊开各条折叠缝，内容仍收起。'
      }, h(Toggle, {
        checked: settings.mergeByDefault,
        label: '默认只留一个按钮',
        onChange: (value) => patch({ mergeByDefault: value })
      })),
      h(Row, {
        label: '按钮显示文字',
        hint: '开：三个按钮各带「展开全部 / 展开所有步骤 / 展开本步骤」文字；关：只留三个不同的箭头图标。'
      }, h(Toggle, {
        checked: settings.stepLabels,
        label: '按钮显示文字',
        onChange: (value) => patch({ stepLabels: value })
      })))
  }

  return SettingsPanel
}
