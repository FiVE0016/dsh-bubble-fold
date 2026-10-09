/**
 * Host half of dsh-ui-beautify (display name: UI 美化).
 *
 * This plugin is deliberately client-only: it changes nothing about the session,
 * the agent, or the model. It exists as a bundle so the client half is served and
 * loaded; it injects no services and registers no tools, commands, or routes.
 *
 * Keep this file importable with zero dependencies. The host imports it with a
 * bare `import()`, so a syntax error here silently disables the entire plugin:
 * the row reports "failed to import" and the client bundle is never composed.
 */
export const name = 'dsh-ui-beautify'

export const inject = []

export function apply() {
  // Intentional no-op: the browser half lives in client.js.
}
