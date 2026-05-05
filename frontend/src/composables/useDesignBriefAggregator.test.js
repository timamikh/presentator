import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import {
  aggregateDesignBrief,
  defaultDesignBrief,
  formatDesignBriefAsPrompt,
  useDesignBriefAggregator,
  TONE_PRESETS,
  COLOR_PALETTES,
} from './useDesignBriefAggregator'

describe('aggregateDesignBrief', () => {
  it('returns a brief with sane defaults when form is empty', () => {
    const brief = aggregateDesignBrief({})
    expect(brief.tone.preset).toBe('minimal')
    expect(brief.palette.primary).toMatch(/^#/)
    expect(brief.typography.heading).toBe('Inter')
    // defaultDesignBrief() seeds graphics.decor with one entry — keeps demos
    // visually richer out of the box.
    expect(Array.isArray(brief.graphics.decor)).toBe(true)
    expect(brief.references).toBeNull()
  })

  it('preserves user-selected tone preset and custom note', () => {
    const brief = aggregateDesignBrief({
      ...defaultDesignBrief(),
      tone: { preset: 'editorial', custom: '  стиль NYT  ' },
    })
    expect(brief.tone.preset).toBe('editorial')
    expect(brief.tone.label).toBe(
      TONE_PRESETS.find((t) => t.id === 'editorial').label,
    )
    expect(brief.tone.custom).toBe('стиль NYT')
  })

  it('keeps palette preset metadata when chosen', () => {
    const brief = aggregateDesignBrief({
      ...defaultDesignBrief(),
      palette: {
        preset: 'midnight',
        primary: '#a855f7',
        accent: '#22d3ee',
        bg: '#0f172a',
        text: '#f8fafc',
        autoFromContent: true,
      },
    })
    expect(brief.palette.preset).toBe('midnight')
    expect(brief.palette.preset_name).toBe(
      COLOR_PALETTES.find((p) => p.id === 'midnight').name,
    )
    expect(brief.palette.auto_from_content).toBe(true)
  })

  it('drops empty optional strings to null', () => {
    const brief = aggregateDesignBrief({
      ...defaultDesignBrief(),
      tone: { preset: 'minimal', custom: '   ' },
      typography: { heading: 'Inter', body: 'Inter', vibe: '' },
      layout: { density: 'balanced', balance: 'asymmetric', constraints: '' },
      references: '',
    })
    expect(brief.tone.custom).toBeNull()
    expect(brief.typography.vibe).toBeNull()
    expect(brief.layout.constraints).toBeNull()
    expect(brief.references).toBeNull()
  })

  it('returns decor as a fresh array (not mutating input)', () => {
    const form = defaultDesignBrief()
    form.graphics.decor = ['tags', 'cards']
    const brief = aggregateDesignBrief(form)
    expect(brief.graphics.decor).toEqual(['tags', 'cards'])
    brief.graphics.decor.push('icons')
    expect(form.graphics.decor).toEqual(['tags', 'cards'])
  })
})

describe('formatDesignBriefAsPrompt', () => {
  it('produces a multi-line text with section headers', () => {
    const text = formatDesignBriefAsPrompt(defaultDesignBrief())
    expect(text).toMatch(/# Design brief/)
    expect(text).toMatch(/Палитра:/)
    expect(text).toMatch(/Типографика:/)
    expect(text).toMatch(/Layout:/)
    expect(text).toMatch(/Графика:/)
  })

  it('includes references when provided', () => {
    const form = { ...defaultDesignBrief(), references: 'Apple Keynote стиль' }
    const text = formatDesignBriefAsPrompt(form)
    expect(text).toMatch(/Референсы/)
    expect(text).toMatch(/Apple Keynote стиль/)
  })

  it('omits references section when empty', () => {
    const text = formatDesignBriefAsPrompt({ ...defaultDesignBrief(), references: '   ' })
    expect(text).not.toMatch(/Референсы/)
  })

  it('mentions auto-from-content flag when enabled', () => {
    const form = defaultDesignBrief()
    form.palette.autoFromContent = true
    const text = formatDesignBriefAsPrompt(form)
    expect(text).toMatch(/Авто-палитра/)
  })
})

describe('useDesignBriefAggregator', () => {
  it('exposes reactive brief and promptText computeds', () => {
    const form = ref(defaultDesignBrief())
    const { brief, promptText } = useDesignBriefAggregator(form)
    expect(brief.value.tone.preset).toBe('minimal')

    form.value = { ...form.value, tone: { preset: 'playful', custom: '' } }
    expect(brief.value.tone.preset).toBe('playful')
    expect(promptText.value).toMatch(/playful|Игривый/)
  })
})
