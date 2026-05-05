// Aggregates the structured DesignBriefForm output into:
//   1) a stable JSON brief (sent to api-service as designBrief and stored in
//      jobs.design_input — fed to the Stage 2 LLM call by n8n);
//   2) a human-readable text preview shown in the UI underneath the form.
//
// Keeping the aggregation pure-functional makes it trivially unit-testable
// and lets the same logic run on the server later if we ever want headless
// brief generation.

import { computed } from 'vue'

export const TONE_PRESETS = [
  { id: 'minimal', label: 'Минимализм' },
  { id: 'corporate', label: 'Корпоративный' },
  { id: 'editorial', label: 'Редакционный (журнал)' },
  { id: 'playful', label: 'Игривый' },
  { id: 'techno', label: 'Техно / диджитал' },
  { id: 'hand_drawn', label: 'Рисованный / human' },
]

export const COLOR_PALETTES = [
  { id: 'classic_blue', name: 'Классический синий', primary: '#2563eb', accent: '#f59e0b', bg: '#ffffff', text: '#0f172a' },
  { id: 'forest', name: 'Лесной', primary: '#15803d', accent: '#facc15', bg: '#fafaf9', text: '#0c0a09' },
  { id: 'sunset', name: 'Закат', primary: '#dc2626', accent: '#fb923c', bg: '#fffbeb', text: '#1c1917' },
  { id: 'mono', name: 'Монохром', primary: '#0f172a', accent: '#9ca3af', bg: '#ffffff', text: '#0f172a' },
  { id: 'midnight', name: 'Полночь', primary: '#a855f7', accent: '#22d3ee', bg: '#0f172a', text: '#f8fafc' },
]

export const FONT_OPTIONS = [
  'Inter',
  'Roboto',
  'Manrope',
  'Open Sans',
  'Montserrat',
  'PT Sans',
  'Playfair Display',
  'Merriweather',
  'IBM Plex Sans',
  'JetBrains Mono',
]

export const LAYOUT_DENSITY = [
  { id: 'airy', label: 'Просторный' },
  { id: 'balanced', label: 'Сбалансированный' },
  { id: 'dense', label: 'Плотный' },
]

export const LAYOUT_BALANCE = [
  { id: 'symmetric', label: 'Симметричный' },
  { id: 'asymmetric', label: 'Асимметричный' },
]

export const IMAGE_STYLES = [
  { id: 'photo', label: 'Фотографии' },
  { id: 'illustration', label: 'Иллюстрации' },
  { id: '3d', label: '3D-рендер' },
  { id: 'mixed', label: 'Смешанный' },
  { id: 'none', label: 'Без изображений' },
]

export const DECOR_OPTIONS = [
  { id: 'tags', label: 'Теги / пилюли' },
  { id: 'icons', label: 'Иконки / эмодзи' },
  { id: 'accent_lines', label: 'Акцентные полосы' },
  { id: 'cards', label: 'Карточки с тенями' },
  { id: 'gradients', label: 'Градиенты' },
  { id: 'numbers', label: 'Большие числа' },
]

export function defaultDesignBrief() {
  return {
    tone: { preset: 'minimal', custom: '' },
    palette: {
      preset: 'classic_blue',
      primary: '#2563eb',
      accent: '#f59e0b',
      bg: '#ffffff',
      text: '#0f172a',
      autoFromContent: false,
    },
    typography: {
      heading: 'Inter',
      body: 'Inter',
      vibe: '',
    },
    layout: {
      density: 'balanced',
      balance: 'asymmetric',
      constraints: '',
    },
    graphics: {
      imageStyle: 'mixed',
      decor: ['accent_lines'],
    },
    references: '',
  }
}

function findById(list, id) {
  return list.find((item) => item.id === id) || null
}

// Build a compact JSON brief (used as designBrief / design_input in API).
export function aggregateDesignBrief(form) {
  const safe = { ...defaultDesignBrief(), ...(form || {}) }

  const toneEntry = findById(TONE_PRESETS, safe.tone?.preset)
  const paletteEntry = findById(COLOR_PALETTES, safe.palette?.preset)

  return {
    tone: {
      preset: safe.tone?.preset || 'minimal',
      label: toneEntry ? toneEntry.label : safe.tone?.preset,
      custom: (safe.tone?.custom || '').trim() || null,
    },
    palette: {
      preset: paletteEntry ? paletteEntry.id : null,
      preset_name: paletteEntry ? paletteEntry.name : null,
      primary: safe.palette?.primary,
      accent: safe.palette?.accent,
      bg: safe.palette?.bg,
      text: safe.palette?.text,
      auto_from_content: !!safe.palette?.autoFromContent,
    },
    typography: {
      heading: safe.typography?.heading || 'Inter',
      body: safe.typography?.body || 'Inter',
      vibe: (safe.typography?.vibe || '').trim() || null,
    },
    layout: {
      density: safe.layout?.density || 'balanced',
      balance: safe.layout?.balance || 'asymmetric',
      constraints: (safe.layout?.constraints || '').trim() || null,
    },
    graphics: {
      image_style: safe.graphics?.imageStyle || 'mixed',
      decor: Array.isArray(safe.graphics?.decor) ? [...safe.graphics.decor] : [],
    },
    references: (safe.references || '').trim() || null,
  }
}

// Render the JSON brief as a human-readable text prompt that the LLM (Stage 2)
// can consume directly. Keeping this string short and well-structured keeps
// the design output stable.
export function formatDesignBriefAsPrompt(form) {
  const brief = aggregateDesignBrief(form)
  const lines = []

  lines.push('# Design brief')
  lines.push('')
  lines.push(`Тон и стиль: ${brief.tone.label || brief.tone.preset}`)
  if (brief.tone.custom) {
    lines.push(`Дополнительно по тону: ${brief.tone.custom}`)
  }
  lines.push('')

  lines.push('Палитра:')
  if (brief.palette.preset_name) {
    lines.push(`- Пресет: ${brief.palette.preset_name}`)
  }
  if (brief.palette.auto_from_content) {
    lines.push('- Авто-палитра из контента включена (можно адаптировать цвета)')
  }
  lines.push(`- Основной: ${brief.palette.primary}`)
  lines.push(`- Акцент:   ${brief.palette.accent}`)
  lines.push(`- Фон:      ${brief.palette.bg}`)
  lines.push(`- Текст:    ${brief.palette.text}`)
  lines.push('')

  lines.push('Типографика:')
  lines.push(`- Заголовки: ${brief.typography.heading}`)
  lines.push(`- Основной текст: ${brief.typography.body}`)
  if (brief.typography.vibe) {
    lines.push(`- Желаемое ощущение: ${brief.typography.vibe}`)
  }
  lines.push('')

  lines.push('Layout:')
  lines.push(`- Плотность: ${brief.layout.density}`)
  lines.push(`- Баланс: ${brief.layout.balance}`)
  if (brief.layout.constraints) {
    lines.push(`- Ограничения: ${brief.layout.constraints}`)
  }
  lines.push('')

  lines.push('Графика:')
  lines.push(`- Стиль изображений: ${brief.graphics.image_style}`)
  if (brief.graphics.decor.length > 0) {
    lines.push(`- Декор: ${brief.graphics.decor.join(', ')}`)
  } else {
    lines.push('- Декор: без декора')
  }
  lines.push('')

  if (brief.references) {
    lines.push('Референсы / примеры:')
    lines.push(brief.references)
  }

  return lines.join('\n')
}

export function useDesignBriefAggregator(formRef) {
  const brief = computed(() => aggregateDesignBrief(formRef?.value))
  const promptText = computed(() => formatDesignBriefAsPrompt(formRef?.value))
  return { brief, promptText }
}
