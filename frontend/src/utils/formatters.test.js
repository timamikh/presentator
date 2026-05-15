import { describe, it, expect } from 'vitest'
import {
  fmtNum,
  fmtTimestamp,
  STAGE_LABELS,
  stageLabel,
  kindBadge,
  KIND_BADGE,
} from './formatters'

describe('fmtNum', () => {
  it('formats finite numbers with locale thousand separators', () => {
    // Russian locale uses NBSP (\u00A0) as the thousand separator.
    expect(fmtNum(1234567)).toBe('1\u00A0234\u00A0567')
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(-42)).toBe('-42')
  })

  it('returns "0" for non-numeric / non-finite input (never "undefined")', () => {
    expect(fmtNum(undefined)).toBe('0')
    expect(fmtNum(null)).toBe('0')
    expect(fmtNum('not a number')).toBe('0')
    expect(fmtNum(Number.NaN)).toBe('0')
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('0')
  })

  it('parses numeric strings', () => {
    expect(fmtNum('1500')).toBe('1\u00A0500')
  })
})

describe('fmtTimestamp', () => {
  it('returns empty string for empty / invalid input', () => {
    expect(fmtTimestamp(null)).toBe('')
    expect(fmtTimestamp(undefined)).toBe('')
    expect(fmtTimestamp('')).toBe('')
    expect(fmtTimestamp('not a date')).toBe('')
  })

  it('formats ISO strings as "DD MMM HH:MM"', () => {
    // The exact letters depend on ICU, but the result must contain the
    // day-of-month and a colon-separated time. We assert the shape, not
    // the exact text, so the test is locale-data-independent.
    const out = fmtTimestamp('2026-05-15T08:53:00Z')
    expect(out).toMatch(/\d{2}/) // day
    expect(out).toMatch(/\d{2}:\d{2}/) // HH:MM
  })

  it('accepts Date instances and epoch numbers', () => {
    const fromDate = fmtTimestamp(new Date('2026-05-15T08:53:00Z'))
    const fromEpoch = fmtTimestamp(new Date('2026-05-15T08:53:00Z').getTime())
    expect(fromDate).not.toBe('')
    expect(fromEpoch).not.toBe('')
    expect(fromDate).toBe(fromEpoch)
  })
})

describe('stageLabel / STAGE_LABELS', () => {
  it('translates known stages to Russian labels', () => {
    expect(stageLabel('planning')).toBe('Планирование')
    expect(stageLabel('design')).toBe('Дизайн')
    expect(stageLabel('layout')).toBe('Верстка')
    expect(stageLabel('refine_layout')).toBe('Доработка')
  })

  it('returns the raw key for unknown stages', () => {
    expect(stageLabel('custom_stage')).toBe('custom_stage')
  })

  it('returns "—" for empty input (never crashes the UI)', () => {
    expect(stageLabel(null)).toBe('—')
    expect(stageLabel(undefined)).toBe('—')
    expect(stageLabel('')).toBe('—')
  })

  it('STAGE_LABELS is a frozen object (prevents accidental mutation)', () => {
    expect(Object.isFrozen(STAGE_LABELS)).toBe(true)
  })
})

describe('kindBadge / KIND_BADGE', () => {
  it('returns a {label, cls} pair for each known kind', () => {
    for (const k of ['auto', 'manual', 'restore', 'initial', 'edit']) {
      const b = kindBadge(k)
      expect(typeof b.label).toBe('string')
      expect(typeof b.cls).toBe('string')
      expect(b.cls.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the kind itself for unknown values', () => {
    const b = kindBadge('weirdkind')
    expect(b.label).toBe('weirdkind')
    expect(b.cls).toMatch(/bg-/)
  })

  it('returns a default badge for empty input', () => {
    const b = kindBadge('')
    expect(b.label).toBe('?')
  })

  it('KIND_BADGE is frozen', () => {
    expect(Object.isFrozen(KIND_BADGE)).toBe(true)
  })
})
