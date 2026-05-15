// Cross-component formatting helpers. Extracted from MetricsView,
// VersionsPanel and DraftsPanel so the algorithms can be unit-tested
// without spinning up Vue.
//
// Conventions:
//   • Locale defaults to ru-RU (the UI is русско­язычный); callers may
//     override it for tests or future i18n.
//   • Date formatters accept ISO strings, Date objects, or epoch ms and
//     return '' for empty input rather than throwing — components render
//     timestamps inside lists where one bad row should not crash the view.

const DEFAULT_LOCALE = 'ru-RU'

/**
 * Pretty-print a numeric value with thousand separators. Non-numeric
 * input returns '0' so summary cards do not show "undefined".
 */
export function fmtNum(value, locale = DEFAULT_LOCALE) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(locale)
}

/**
 * Format a timestamp as "DD MMM HH:MM" in the given locale. Returns '' for
 * null/undefined/invalid inputs.
 */
export function fmtTimestamp(value, locale = DEFAULT_LOCALE) {
  if (value === null || value === undefined || value === '') return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Pipeline stage → human label mapping (shared by Metrics + Versions panels).
export const STAGE_LABELS = Object.freeze({
  planning: 'Планирование',
  design: 'Дизайн',
  layout: 'Верстка',
  refine_layout: 'Доработка',
  render: 'Рендер',
})

/**
 * Translate a pipeline stage key (planning / design / layout / refine_layout)
 * into a Russian label. Unknown keys are returned verbatim; falsy input
 * yields a placeholder dash.
 */
export function stageLabel(stage) {
  if (!stage) return '—'
  return STAGE_LABELS[stage] || stage
}

// Snapshot-kind badge styling (shared by VersionsPanel + DraftsPanel).
// The two panels show slightly different kinds: snapshots emit 'auto',
// 'manual', 'restore'; drafts emit 'initial', 'edit', 'restore'. Both
// share 'restore' so a single map covers all five values.
export const KIND_BADGE = Object.freeze({
  auto: { label: 'auto', cls: 'bg-blue-100 text-blue-700' },
  manual: { label: 'manual', cls: 'bg-purple-100 text-purple-700' },
  initial: { label: 'init', cls: 'bg-blue-100 text-blue-700' },
  edit: { label: 'edit', cls: 'bg-gray-100 text-gray-700' },
  restore: { label: 'restore', cls: 'bg-amber-100 text-amber-700' },
})

const DEFAULT_BADGE = Object.freeze({ label: '?', cls: 'bg-gray-100 text-gray-700' })

/**
 * Look up a badge descriptor by kind. Falls back to a neutral grey badge
 * with the kind itself as the label, so unknown values stay visible.
 */
export function kindBadge(kind) {
  if (typeof kind !== 'string' || kind.length === 0) return DEFAULT_BADGE
  return KIND_BADGE[kind] || { label: kind, cls: DEFAULT_BADGE.cls }
}
