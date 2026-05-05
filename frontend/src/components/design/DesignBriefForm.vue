<script setup>
// DesignBriefForm — multi-tab brief editor used during job creation.
//
// The form is structured (tabs: Tone / Palette / Typography / Layout / Graphics
// / References) and emits an object that useDesignBriefAggregator turns into
// both a JSON brief and a human-readable text preview. The preview is shown
// inline so the user can see exactly what the LLM will receive.

import { ref, computed, watch } from 'vue'
import client from '../../api/client'
import {
  TONE_PRESETS,
  COLOR_PALETTES,
  FONT_OPTIONS,
  LAYOUT_DENSITY,
  LAYOUT_BALANCE,
  IMAGE_STYLES,
  DECOR_OPTIONS,
  defaultDesignBrief,
  formatDesignBriefAsPrompt,
  aggregateDesignBrief,
} from '../../composables/useDesignBriefAggregator'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => defaultDesignBrief()
  },
  slideCount: {
    type: Number,
    default: 0
  }
})
const emit = defineEmits(['update:modelValue', 'update:slideCount'])

const TABS = [
  { id: 'tone', label: 'Тон' },
  { id: 'palette', label: 'Палитра' },
  { id: 'typography', label: 'Шрифты' },
  { id: 'layout', label: 'Layout' },
  { id: 'graphics', label: 'Графика' },
  { id: 'references', label: 'Референсы' },
]

const activeTab = ref('tone')
const showPreview = ref(false)
const presets = ref([])
const selectedPresetId = ref('')
const presetSaving = ref(false)
const newPresetName = ref('')

function update(partial) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function updateSection(section, partial) {
  emit('update:modelValue', {
    ...props.modelValue,
    [section]: { ...(props.modelValue?.[section] || {}), ...partial },
  })
}

function applyPalette(paletteId) {
  const palette = COLOR_PALETTES.find((p) => p.id === paletteId)
  if (!palette) return
  updateSection('palette', {
    preset: palette.id,
    primary: palette.primary,
    accent: palette.accent,
    bg: palette.bg,
    text: palette.text,
  })
}

function toggleDecor(decorId) {
  const current = props.modelValue?.graphics?.decor || []
  const next = current.includes(decorId)
    ? current.filter((d) => d !== decorId)
    : [...current, decorId]
  updateSection('graphics', { decor: next })
}

const previewText = computed(() => formatDesignBriefAsPrompt(props.modelValue))
const aggregated = computed(() => aggregateDesignBrief(props.modelValue))

async function loadPresets() {
  try {
    const { data } = await client.get('/design-presets')
    presets.value = Array.isArray(data) ? data : []
  } catch {
    // Non-fatal: presets are optional UX
  }
}

async function applyPreset() {
  if (!selectedPresetId.value) return
  const preset = presets.value.find((p) => p.id === selectedPresetId.value)
  if (!preset) return
  emit('update:modelValue', { ...defaultDesignBrief(), ...(preset.brief_json || {}) })
}

async function saveCurrentAsPreset() {
  const name = newPresetName.value.trim()
  if (!name) return
  presetSaving.value = true
  try {
    const { data } = await client.post('/design-presets', {
      name,
      brief: props.modelValue,
    })
    const idx = presets.value.findIndex((p) => p.id === data.id)
    if (idx >= 0) presets.value.splice(idx, 1, data)
    else presets.value.unshift(data)
    selectedPresetId.value = data.id
    newPresetName.value = ''
  } catch {
    // surface errors via inline alert if needed
  } finally {
    presetSaving.value = false
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (!val) emit('update:modelValue', defaultDesignBrief())
  },
  { immediate: true }
)

loadPresets()

defineExpose({ aggregated })
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-900">Дизайн презентации</h2>
      <button
        type="button"
        class="text-xs text-gray-500 hover:text-gray-700"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? 'Скрыть превью' : 'Превью промпта' }}
      </button>
    </div>

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
        0 — модель сама выберет количество, иначе задаём жёсткую рамку.
      </p>
    </div>

    <div class="border-b border-gray-200">
      <div class="flex flex-wrap -mb-px">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          :class="[
            'px-3 py-2 text-xs font-medium border-b-2 transition-colors',
            activeTab === tab.id
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          ]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- Tone -->
    <div v-if="activeTab === 'tone'" class="space-y-3">
      <p class="text-xs text-gray-500">
        Какое настроение должна транслировать презентация. Один пресет +
        опциональный комментарий.
      </p>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="t in TONE_PRESETS"
          :key="t.id"
          type="button"
          :class="[
            'border rounded-lg px-3 py-2 text-left text-xs transition',
            modelValue.tone?.preset === t.id
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-200 hover:border-gray-300'
          ]"
          @click="updateSection('tone', { preset: t.id })"
        >
          {{ t.label }}
        </button>
      </div>
      <textarea
        :value="modelValue.tone?.custom || ''"
        rows="2"
        placeholder="Дополнительно про тон (опционально)…"
        class="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
        @input="updateSection('tone', { custom: $event.target.value })"
      />
    </div>

    <!-- Palette -->
    <div v-if="activeTab === 'palette'" class="space-y-3">
      <p class="text-xs text-gray-500">
        Готовая палитра или ручная настройка цветов.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="p in COLOR_PALETTES"
          :key="p.id"
          type="button"
          :class="[
            'flex items-center gap-2 border rounded-lg px-3 py-2 text-left text-xs transition',
            modelValue.palette?.preset === p.id
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-200 hover:border-gray-300'
          ]"
          @click="applyPalette(p.id)"
        >
          <span class="flex gap-1 shrink-0">
            <span class="w-3 h-3 rounded" :style="{ background: p.primary }" />
            <span class="w-3 h-3 rounded" :style="{ background: p.accent }" />
            <span class="w-3 h-3 rounded border border-gray-300" :style="{ background: p.bg }" />
          </span>
          <span>{{ p.name }}</span>
        </button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div v-for="key in ['primary', 'accent', 'bg', 'text']" :key="key">
          <label class="block text-[11px] text-gray-500 mb-1 uppercase tracking-wide">
            {{ key }}
          </label>
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="modelValue.palette?.[key] || '#000000'"
              @input="updateSection('palette', { [key]: $event.target.value, preset: null })"
              class="h-8 w-8 rounded border border-gray-200 cursor-pointer"
            />
            <input
              type="text"
              :value="modelValue.palette?.[key] || ''"
              @input="updateSection('palette', { [key]: $event.target.value, preset: null })"
              class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
            />
          </div>
        </div>
      </div>

      <label class="inline-flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          :checked="modelValue.palette?.autoFromContent"
          @change="updateSection('palette', { autoFromContent: $event.target.checked })"
        />
        Разрешить модели подобрать палитру под контент
      </label>
    </div>

    <!-- Typography -->
    <div v-if="activeTab === 'typography'" class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Шрифт заголовков</label>
          <select
            :value="modelValue.typography?.heading"
            @change="updateSection('typography', { heading: $event.target.value })"
            class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
          >
            <option v-for="f in FONT_OPTIONS" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Шрифт текста</label>
          <select
            :value="modelValue.typography?.body"
            @change="updateSection('typography', { body: $event.target.value })"
            class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
          >
            <option v-for="f in FONT_OPTIONS" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Желаемое ощущение от типографики
        </label>
        <textarea
          :value="modelValue.typography?.vibe || ''"
          rows="2"
          placeholder="Например: крупные заголовки, узкие шрифты, много воздуха…"
          class="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          @input="updateSection('typography', { vibe: $event.target.value })"
        />
      </div>
    </div>

    <!-- Layout -->
    <div v-if="activeTab === 'layout'" class="space-y-3">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Плотность</label>
        <div class="flex gap-2">
          <button
            v-for="d in LAYOUT_DENSITY"
            :key="d.id"
            type="button"
            :class="[
              'flex-1 border rounded-lg px-3 py-2 text-xs transition',
              modelValue.layout?.density === d.id
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            ]"
            @click="updateSection('layout', { density: d.id })"
          >
            {{ d.label }}
          </button>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Композиция</label>
        <div class="flex gap-2">
          <button
            v-for="b in LAYOUT_BALANCE"
            :key="b.id"
            type="button"
            :class="[
              'flex-1 border rounded-lg px-3 py-2 text-xs transition',
              modelValue.layout?.balance === b.id
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            ]"
            @click="updateSection('layout', { balance: b.id })"
          >
            {{ b.label }}
          </button>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Ограничения / пожелания</label>
        <textarea
          :value="modelValue.layout?.constraints || ''"
          rows="2"
          placeholder="Например: всегда заголовок сверху, обязательная сетка 12 колонок…"
          class="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          @input="updateSection('layout', { constraints: $event.target.value })"
        />
      </div>
    </div>

    <!-- Graphics -->
    <div v-if="activeTab === 'graphics'" class="space-y-3">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Стиль изображений</label>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="i in IMAGE_STYLES"
            :key="i.id"
            type="button"
            :class="[
              'border rounded-lg px-3 py-2 text-xs transition',
              modelValue.graphics?.imageStyle === i.id
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            ]"
            @click="updateSection('graphics', { imageStyle: i.id })"
          >
            {{ i.label }}
          </button>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Декор</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="d in DECOR_OPTIONS"
            :key="d.id"
            type="button"
            :class="[
              'border rounded-full px-3 py-1 text-xs transition',
              (modelValue.graphics?.decor || []).includes(d.id)
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            ]"
            @click="toggleDecor(d.id)"
          >
            {{ d.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- References -->
    <div v-if="activeTab === 'references'" class="space-y-3">
      <p class="text-xs text-gray-500">
        Свободный текст: «равняюсь на стиль X», ссылки на референсы (учитывается
        как контекст).
      </p>
      <textarea
        :value="modelValue.references || ''"
        rows="4"
        placeholder="Например: стиль Apple Keynote, презентации Stripe, дизайн Figma Config…"
        class="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
        @input="update({ references: $event.target.value })"
      />
    </div>

    <!-- Preset shelf -->
    <div class="border-t border-gray-100 pt-3 space-y-2">
      <div class="flex items-center gap-2">
        <select
          v-model="selectedPresetId"
          class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
        >
          <option value="">Свой бриф (без пресета)</option>
          <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button
          type="button"
          class="px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded"
          :disabled="!selectedPresetId"
          @click="applyPreset"
        >
          Применить
        </button>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="newPresetName"
          type="text"
          placeholder="Имя нового пресета"
          class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs"
        />
        <button
          type="button"
          class="px-2 py-1.5 text-xs text-white bg-gray-700 rounded hover:bg-gray-800 disabled:opacity-50"
          :disabled="!newPresetName.trim() || presetSaving"
          @click="saveCurrentAsPreset"
        >
          Сохранить
        </button>
      </div>
    </div>

    <!-- Preview -->
    <div v-if="showPreview" class="bg-gray-900 text-gray-200 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap leading-relaxed">{{ previewText }}</div>
  </div>
</template>
