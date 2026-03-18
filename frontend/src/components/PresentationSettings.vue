<script setup>
import { computed } from 'vue'

const props = defineProps({
  slideCount: {
    type: Number,
    default: 0
  },
  modelValue: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:slideCount', 'update:modelValue'])

const fonts = [
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Inter',
  'Roboto'
]

function updateSettings(partial) {
  emit('update:modelValue', {
    ...props.modelValue,
    ...partial
  })
}

const PALETTE_MIN = 2
const PALETTE_MAX = 5
const TEXT_STYLES_MIN = 2
const TEXT_STYLES_MAX = 5

const paletteRoles = [
  { value: 'bg_primary', label: 'Фон слайдов' },
  { value: 'bg_alt', label: 'Фон блоков/карточек' },
  { value: 'accent_primary', label: 'Основной акцент' },
  { value: 'accent_secondary', label: 'Вторичный акцент' },
  { value: 'text_primary', label: 'Основной текст' },
  { value: 'border_divider', label: 'Линии/бордеры' },
  { value: 'highlight', label: 'Подсветка/бейджи' }
]

const styleTags = [
  { value: 'airy', label: 'Воздушный' },
  { value: 'minimalistic', label: 'Минималистичный' },
  { value: 'corporate', label: 'Корпоративный' },
  { value: 'playful', label: 'Игривый' },
  { value: 'bold_contrast', label: 'Контрастный' },
  { value: 'editorial', label: 'Редакционный' },
  { value: 'tech_futuristic', label: 'Техно/футуризм' },
  { value: 'dark_mode', label: 'Тёмный' }
]

const textApplyTo = [
  { value: 'titles', label: 'Заголовки' },
  { value: 'subtitles', label: 'Подзаголовки/лиды' },
  { value: 'body', label: 'Основной текст' },
  { value: 'captions', label: 'Подписи/мелкий текст' },
  { value: 'numbers_stats', label: 'Числа/метрики' },
  { value: 'quotes', label: 'Цитаты' },
  { value: 'code', label: 'Код/моно' },
  { value: 'lists', label: 'Списки' },
  { value: 'tables', label: 'Таблицы' },
  { value: 'tags_badges', label: 'Теги/бейджи' }
]

function ensureDefaults(input) {
  const mv = input && typeof input === 'object' ? input : {}

  const design = mv.design && typeof mv.design === 'object' ? mv.design : {}
  const palette = Array.isArray(design.palette) ? design.palette : null
  const normalizedPalette = (palette && palette.length > 0
    ? palette
    : [
        { hex: mv.backgroundColor || '#ffffff', role: 'bg_primary' },
        { hex: mv.primaryColor || '#2563eb', role: 'accent_primary' }
      ]
  ).map((c, idx) => ({
    hex: typeof c?.hex === 'string' ? c.hex : '#2563eb',
    role: typeof c?.role === 'string' ? c.role : idx === 0 ? 'bg_primary' : 'accent_primary'
  }))

  while (normalizedPalette.length < PALETTE_MIN) {
    normalizedPalette.push({ hex: '#111827', role: 'text_primary' })
  }
  if (normalizedPalette.length > PALETTE_MAX) normalizedPalette.length = PALETTE_MAX

  const normalizedTags = Array.isArray(design.styleTags)
    ? design.styleTags.filter((t) => typeof t === 'string')
    : []

  const textDesign = mv.textDesign && typeof mv.textDesign === 'object' ? mv.textDesign : {}
  const styles = Array.isArray(textDesign.styles) ? textDesign.styles : null

  const legacyFont = mv.fontFamily || 'Inter'
  const legacyTitleFont = mv.titleFontFamily || legacyFont
  const legacySize = Number.isFinite(Number(mv.fontSize)) ? Number(mv.fontSize) : 16

  const normalizedStyles = (styles && styles.length > 0
    ? styles
    : [
        {
          id: 'titles',
          name: 'Заголовки',
          applyTo: ['titles'],
          colorHex: mv.primaryColor || '#2563eb',
          fontFamily: legacyTitleFont,
          fontWeight: 700,
          fontStyle: 'normal',
          fontSizePt: Math.max(32, Math.min(72, legacySize * 3))
        },
        {
          id: 'body',
          name: 'Основной текст',
          applyTo: ['body'],
          colorHex: '#111827',
          fontFamily: legacyFont,
          fontWeight: 400,
          fontStyle: 'normal',
          fontSizePt: Math.max(18, Math.min(40, legacySize * 1.75))
        }
      ]
  ).map((s, i) => ({
    id: typeof s?.id === 'string' ? s.id : `style_${i + 1}`,
    name: typeof s?.name === 'string' ? s.name : `Стиль ${i + 1}`,
    applyTo: Array.isArray(s?.applyTo) ? s.applyTo.filter((x) => typeof x === 'string') : [],
    colorHex: typeof s?.colorHex === 'string' ? s.colorHex : '#111827',
    fontFamily: typeof s?.fontFamily === 'string' ? s.fontFamily : 'Inter',
    fontWeight: Number.isFinite(Number(s?.fontWeight)) ? Number(s.fontWeight) : 400,
    fontStyle: s?.fontStyle === 'italic' ? 'italic' : 'normal',
    fontSizePt: Number.isFinite(Number(s?.fontSizePt)) ? Number(s.fontSizePt) : 28
  }))

  while (normalizedStyles.length < TEXT_STYLES_MIN) {
    normalizedStyles.push({
      id: `style_${normalizedStyles.length + 1}`,
      name: `Стиль ${normalizedStyles.length + 1}`,
      applyTo: [],
      colorHex: '#111827',
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal',
      fontSizePt: 28
    })
  }
  if (normalizedStyles.length > TEXT_STYLES_MAX) normalizedStyles.length = TEXT_STYLES_MAX

  return {
    ...mv,
    design: {
      palette: normalizedPalette,
      styleTags: normalizedTags,
      customDesignPrompt: typeof design.customDesignPrompt === 'string' ? design.customDesignPrompt : ''
    },
    textDesign: {
      styles: normalizedStyles
    }
  }
}

const normalized = computed(() => ensureDefaults(props.modelValue))

function updateDesign(partial) {
  const mv = ensureDefaults(props.modelValue)
  updateSettings({
    design: {
      ...mv.design,
      ...partial
    }
  })
}

function updateTextDesign(partial) {
  const mv = ensureDefaults(props.modelValue)
  updateSettings({
    textDesign: {
      ...mv.textDesign,
      ...partial
    }
  })
}

function addPaletteColor() {
  const mv = ensureDefaults(props.modelValue)
  const palette = mv.design.palette.slice()
  if (palette.length >= PALETTE_MAX) return
  palette.push({ hex: '#22c55e', role: 'accent_secondary' })
  updateDesign({ palette })
}

function removePaletteColor(index) {
  const mv = ensureDefaults(props.modelValue)
  const palette = mv.design.palette.slice()
  if (palette.length <= PALETTE_MIN) return
  palette.splice(index, 1)
  updateDesign({ palette })
}

function updatePaletteColor(index, partial) {
  const mv = ensureDefaults(props.modelValue)
  const palette = mv.design.palette.slice()
  palette[index] = { ...palette[index], ...partial }
  updateDesign({ palette })
}

function toggleStyleTag(tag) {
  const mv = ensureDefaults(props.modelValue)
  const set = new Set(mv.design.styleTags || [])
  if (set.has(tag)) set.delete(tag)
  else set.add(tag)
  updateDesign({ styleTags: Array.from(set) })
}

function addTextStyle() {
  const mv = ensureDefaults(props.modelValue)
  const styles = mv.textDesign.styles.slice()
  if (styles.length >= TEXT_STYLES_MAX) return
  styles.push({
    id: `style_${styles.length + 1}`,
    name: `Стиль ${styles.length + 1}`,
    applyTo: [],
    colorHex: '#111827',
    fontFamily: mv.fontFamily || 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSizePt: 28
  })
  updateTextDesign({ styles })
}

function removeTextStyle(index) {
  const mv = ensureDefaults(props.modelValue)
  const styles = mv.textDesign.styles.slice()
  if (styles.length <= TEXT_STYLES_MIN) return
  styles.splice(index, 1)
  updateTextDesign({ styles })
}

function updateTextStyle(index, partial) {
  const mv = ensureDefaults(props.modelValue)
  const styles = mv.textDesign.styles.slice()
  styles[index] = { ...styles[index], ...partial }
  updateTextDesign({ styles })
}

function toggleApplyTo(styleIndex, key) {
  const mv = ensureDefaults(props.modelValue)
  const styles = mv.textDesign.styles.slice()
  const s = { ...styles[styleIndex] }
  const set = new Set(Array.isArray(s.applyTo) ? s.applyTo : [])
  if (set.has(key)) set.delete(key)
  else set.add(key)
  s.applyTo = Array.from(set)
  styles[styleIndex] = s
  updateTextDesign({ styles })
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-900">Настройки презентации</h2>
      <span class="text-xs text-gray-400">Опционально</span>
    </div>

    <div class="space-y-3">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Количество слайдов
        </label>
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="20"
            :value="slideCount"
            @input="emit('update:slideCount', Number($event.target.value))"
            class="w-full"
          />
          <input
            type="number"
            min="0"
            max="20"
            :value="slideCount"
            @input="emit('update:slideCount', Number($event.target.value))"
            class="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
          />
        </div>
        <p class="mt-1 text-[11px] text-gray-400">
          0 — доверить количество слайдов модели; больше — жёстко задать рамку.
        </p>
      </div>

      <div class="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold text-gray-900">Дизайн презентации</h3>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500">
              {{ normalized.design.palette.length }} / {{ PALETTE_MAX }} цветов
            </span>
            <button
              type="button"
              class="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
              :disabled="normalized.design.palette.length >= PALETTE_MAX"
              @click="addPaletteColor"
            >
              Добавить цвет
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <div
            v-for="(c, idx) in normalized.design.palette"
            :key="idx"
            class="bg-white rounded-lg border border-gray-200 p-2"
          >
            <div class="flex items-center gap-2">
              <input
                type="color"
                :value="c.hex"
                @input="updatePaletteColor(idx, { hex: $event.target.value })"
                class="h-8 w-8 rounded border border-gray-200 cursor-pointer"
              />
              <input
                type="text"
                :value="c.hex"
                @input="updatePaletteColor(idx, { hex: $event.target.value })"
                class="w-28 px-2 py-1 border border-gray-300 rounded text-xs"
              />
              <select
                :value="c.role"
                @change="updatePaletteColor(idx, { role: $event.target.value })"
                class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
              >
                <option v-for="r in paletteRoles" :key="r.value" :value="r.value">
                  {{ r.label }}
                </option>
              </select>
              <button
                type="button"
                class="text-gray-400 hover:text-red-500 disabled:opacity-40"
                :disabled="normalized.design.palette.length <= PALETTE_MIN"
                @click="removePaletteColor(idx)"
                title="Удалить цвет"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Стиль (теги)</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="t in styleTags"
              :key="t.value"
              type="button"
              @click="toggleStyleTag(t.value)"
              :class="[
                'text-[11px] px-2 py-1 rounded-full border transition',
                normalized.design.styleTags.includes(t.value)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
              ]"
            >
              {{ t.label }}
            </button>
          </div>
          <p class="mt-1 text-[11px] text-gray-500">Можно выбрать несколько — модель объединит требования.</p>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Промт по дизайну</label>
          <textarea
            rows="3"
            :value="normalized.design.customDesignPrompt"
            @input="updateDesign({ customDesignPrompt: $event.target.value })"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none bg-white"
            placeholder="Например: «без градиентов, больше воздуха, строгая сетка»"
          ></textarea>
        </div>
      </div>

      <div class="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold text-gray-900">Дизайн текстов</h3>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500">
              {{ normalized.textDesign.styles.length }} / {{ TEXT_STYLES_MAX }} стилей
            </span>
            <button
              type="button"
              class="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
              :disabled="normalized.textDesign.styles.length >= TEXT_STYLES_MAX"
              @click="addTextStyle"
            >
              Добавить стиль
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <div
            v-for="(s, idx) in normalized.textDesign.styles"
            :key="s.id || idx"
            class="bg-white rounded-lg border border-gray-200 p-3 space-y-2"
          >
            <div class="flex items-center justify-between gap-3">
              <input
                type="text"
                :value="s.name"
                @input="updateTextStyle(idx, { name: $event.target.value })"
                class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                placeholder="Название (опционально)"
              />
              <button
                type="button"
                class="text-gray-400 hover:text-red-500 disabled:opacity-40"
                :disabled="normalized.textDesign.styles.length <= TEXT_STYLES_MIN"
                @click="removeTextStyle(idx)"
                title="Удалить стиль"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div>
              <label class="block text-[11px] font-medium text-gray-700 mb-1">Где используется</label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="a in textApplyTo"
                  :key="a.value"
                  type="button"
                  @click="toggleApplyTo(idx, a.value)"
                  :class="[
                    'text-[11px] px-2 py-1 rounded-full border transition',
                    s.applyTo.includes(a.value)
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                  ]"
                >
                  {{ a.label }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 items-center">
              <div>
                <label class="block text-[11px] font-medium text-gray-700 mb-1">Цвет</label>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    :value="s.colorHex"
                    @input="updateTextStyle(idx, { colorHex: $event.target.value })"
                    class="h-8 w-8 rounded border border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    :value="s.colorHex"
                    @input="updateTextStyle(idx, { colorHex: $event.target.value })"
                    class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                  />
                </div>
              </div>

              <div>
                <label class="block text-[11px] font-medium text-gray-700 mb-1">Шрифт</label>
                <select
                  :value="s.fontFamily"
                  @change="updateTextStyle(idx, { fontFamily: $event.target.value })"
                  class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
                >
                  <option v-for="font in fonts" :key="font" :value="font">
                    {{ font }}
                  </option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-3 items-center">
              <div>
                <label class="block text-[11px] font-medium text-gray-700 mb-1">Жирность</label>
                <select
                  :value="String(s.fontWeight)"
                  @change="updateTextStyle(idx, { fontWeight: Number($event.target.value) })"
                  class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
                >
                  <option value="400">400 (обычный)</option>
                  <option value="500">500</option>
                  <option value="600">600</option>
                  <option value="700">700 (жирный)</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-medium text-gray-700 mb-1">Курсив</label>
                <select
                  :value="s.fontStyle"
                  @change="updateTextStyle(idx, { fontStyle: $event.target.value })"
                  class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
                >
                  <option value="normal">Нет</option>
                  <option value="italic">Да</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-medium text-gray-700 mb-1">Размер (pt)</label>
                <input
                  type="number"
                  min="12"
                  max="72"
                  :value="s.fontSizePt"
                  @input="updateTextStyle(idx, { fontSizePt: Number($event.target.value) })"
                  class="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                />
              </div>
            </div>
          </div>
        </div>

        <p class="text-[11px] text-gray-500">
          Совет: задайте 2–3 стиля (заголовки/основной/подписи) и привяжите “Где используется”.
        </p>
      </div>
    </div>
  </div>
</template>

