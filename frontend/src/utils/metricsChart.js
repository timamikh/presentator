// Pure data-shaping helpers for the /metrics dashboard.
//
// These take server payloads from /api/metrics/* and return the exact
// {labels, datasets} structure that chart.js consumes. The intent is to
// keep `MetricsView.vue` free of business logic so the maths can be
// regression-tested without instantiating Vue / chart.js.

// Default stage palette. Kept in sync with the visual identity used in
// VersionsPanel snapshots so an LLM call coloured X on the dashboard maps
// to the same stage colour throughout the app.
export const STAGE_COLORS = Object.freeze({
  planning: '#3b82f6',
  design: '#a855f7',
  layout: '#22c55e',
  refine_layout: '#f59e0b',
  render: '#64748b',
})

const FALLBACK_COLOR = '#9ca3af'

function toNum(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Build the chart.js dataset for the "Токены по дням" bar chart.
 *
 * @param {Array} rows — from GET /api/metrics/by-day:
 *        [{ day, prompt_tokens, completion_tokens, total_tokens, total_calls }, …]
 * @returns {{ labels: string[], datasets: object[] }}
 */
export function buildByDayChartData(rows) {
  const safe = Array.isArray(rows) ? rows : []
  return {
    labels: safe.map((r) => (r && r.day) || ''),
    datasets: [
      {
        label: 'Prompt',
        data: safe.map((r) => toNum(r && r.prompt_tokens)),
        backgroundColor: '#3b82f6',
      },
      {
        label: 'Completion',
        data: safe.map((r) => toNum(r && r.completion_tokens)),
        backgroundColor: '#10b981',
      },
    ],
  }
}

/**
 * Build the chart.js dataset for the "Токены по этапам" doughnut chart.
 *
 * @param {Array} rows — from GET /api/metrics/by-stage:
 *        [{ stage, total_tokens, total_calls, prompt_tokens, completion_tokens, avg_latency_ms }, …]
 * @param {Function} stageLabel — translator (e.g. utils/formatters → stageLabel)
 * @param {Object} [colorMap=STAGE_COLORS]
 */
export function buildByStageChartData(rows, stageLabel, colorMap = STAGE_COLORS) {
  const safe = Array.isArray(rows) ? rows : []
  const labelFn = typeof stageLabel === 'function' ? stageLabel : (s) => s
  return {
    labels: safe.map((r) => labelFn((r && r.stage) || '')),
    datasets: [
      {
        data: safe.map((r) => toNum(r && r.total_tokens)),
        backgroundColor: safe.map((r) => colorMap[(r && r.stage) || ''] || FALLBACK_COLOR),
        borderWidth: 0,
      },
    ],
  }
}

/**
 * Sort job snapshots so the newest version is first. Used by VersionsPanel.
 * Does NOT mutate the input.
 */
export function sortSnapshotsByVersionDesc(snapshots) {
  if (!Array.isArray(snapshots)) return []
  return [...snapshots].sort((a, b) => toNum(b?.version) - toNum(a?.version))
}
