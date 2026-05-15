import { describe, it, expect } from 'vitest'
import {
  buildByDayChartData,
  buildByStageChartData,
  sortSnapshotsByVersionDesc,
  STAGE_COLORS,
} from './metricsChart'
import { stageLabel } from './formatters'

describe('buildByDayChartData', () => {
  it('extracts labels and two stacked datasets in row order', () => {
    const rows = [
      { day: '2026-05-13', prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      { day: '2026-05-14', prompt_tokens: 250, completion_tokens: 90, total_tokens: 340 },
    ]
    const data = buildByDayChartData(rows)
    expect(data.labels).toEqual(['2026-05-13', '2026-05-14'])
    expect(data.datasets).toHaveLength(2)
    expect(data.datasets[0].label).toBe('Prompt')
    expect(data.datasets[0].data).toEqual([100, 250])
    expect(data.datasets[1].label).toBe('Completion')
    expect(data.datasets[1].data).toEqual([40, 90])
  })

  it('coerces missing numeric fields to 0 (never to NaN)', () => {
    const rows = [
      { day: '2026-05-13' }, // both token counts missing
      { day: '2026-05-14', prompt_tokens: '300', completion_tokens: null },
    ]
    const data = buildByDayChartData(rows)
    expect(data.datasets[0].data).toEqual([0, 300])
    expect(data.datasets[1].data).toEqual([0, 0])
  })

  it('returns empty labels/data for empty or non-array input', () => {
    expect(buildByDayChartData([]).labels).toEqual([])
    expect(buildByDayChartData(null).labels).toEqual([])
    expect(buildByDayChartData(undefined).datasets[0].data).toEqual([])
  })
})

describe('buildByStageChartData', () => {
  it('runs every label through the stageLabel function', () => {
    const rows = [
      { stage: 'planning', total_tokens: 1000 },
      { stage: 'layout', total_tokens: 500 },
    ]
    const data = buildByStageChartData(rows, stageLabel)
    expect(data.labels).toEqual(['Планирование', 'Верстка'])
    expect(data.datasets[0].data).toEqual([1000, 500])
  })

  it('assigns colors via STAGE_COLORS by default', () => {
    const rows = [
      { stage: 'planning', total_tokens: 1 },
      { stage: 'design', total_tokens: 1 },
    ]
    const data = buildByStageChartData(rows, stageLabel)
    expect(data.datasets[0].backgroundColor[0]).toBe(STAGE_COLORS.planning)
    expect(data.datasets[0].backgroundColor[1]).toBe(STAGE_COLORS.design)
  })

  it('falls back to a neutral color for unknown stages', () => {
    const data = buildByStageChartData(
      [{ stage: 'mystery', total_tokens: 1 }],
      stageLabel,
    )
    expect(data.datasets[0].backgroundColor[0]).toBe('#9ca3af')
  })

  it('survives missing stageLabel function (uses identity)', () => {
    const data = buildByStageChartData([{ stage: 'planning', total_tokens: 1 }], null)
    expect(data.labels).toEqual(['planning'])
  })
})

describe('sortSnapshotsByVersionDesc', () => {
  it('sorts a copy of the input by version, descending', () => {
    const input = [
      { id: 'a', version: 1 },
      { id: 'b', version: 3 },
      { id: 'c', version: 2 },
    ]
    const sorted = sortSnapshotsByVersionDesc(input)
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a'])
    // Crucially, the input must NOT be mutated — Vue treats it as
    // reactive state.
    expect(input.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns [] for non-array / null input', () => {
    expect(sortSnapshotsByVersionDesc(null)).toEqual([])
    expect(sortSnapshotsByVersionDesc(undefined)).toEqual([])
    expect(sortSnapshotsByVersionDesc('not an array')).toEqual([])
  })

  it('tolerates missing version fields (treats them as 0)', () => {
    const sorted = sortSnapshotsByVersionDesc([
      { id: 'a' },
      { id: 'b', version: 5 },
      { id: 'c' },
    ])
    expect(sorted[0].id).toBe('b')
  })
})
