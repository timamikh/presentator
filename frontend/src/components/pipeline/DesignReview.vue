<script setup>
// DesignReview — visual summary of the Design stage output (JSON brief).
// Renders palette swatches, font samples, and per-slide layout chips so the
// user can confirm before triggering the Layout stage.

import { ref, watch, computed } from 'vue'

const props = defineProps({
  designBrief: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'regenerate'])

const local = ref(null)
const regeneratePrompt = ref('')

watch(
  () => props.designBrief,
  (val) => {
    local.value = val ? JSON.parse(JSON.stringify(val)) : null
  },
  { immediate: true },
)

const palette = computed(() => local.value?.theme?.palette || {})
const fonts = computed(() => local.value?.theme?.fonts || {})
const slides = computed(() => local.value?.slides || [])
const tone = computed(() => local.value?.theme?.tone || '')

function confirm() {
  emit('confirm', local.value)
}
function regenerate() {
  emit('regenerate', regeneratePrompt.value.trim())
  regeneratePrompt.value = ''
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
    <div>
      <h3 class="text-sm font-semibold text-gray-900">
        Шаг 2. Дизайн-ТЗ
      </h3>
      <p class="text-xs text-gray-500">
        ТЗ для верстальщика: палитра, шрифты, layout. Подтвердите для
        перехода к финальной верстке.
      </p>
    </div>

    <div v-if="!local" class="text-xs text-gray-400">Нет данных дизайна.</div>

    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 class="text-xs font-semibold text-gray-700 mb-2">Палитра</h4>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(color, key) in palette"
              :key="key"
              class="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1 text-xs"
            >
              <span
                class="w-4 h-4 rounded border border-gray-300 shrink-0"
                :style="{ background: color }"
              />
              <span class="text-gray-500 uppercase text-[10px] tracking-wide">{{ key }}</span>
              <span class="font-mono text-gray-800">{{ color }}</span>
            </div>
          </div>
          <p v-if="tone" class="mt-2 text-[11px] text-gray-500">
            Тон: <span class="font-medium">{{ tone }}</span>
          </p>
        </div>

        <div>
          <h4 class="text-xs font-semibold text-gray-700 mb-2">Типографика</h4>
          <p class="text-sm" :style="{ fontFamily: fonts.heading }">
            Heading — <span class="text-gray-500 text-xs">{{ fonts.heading || '—' }}</span>
          </p>
          <p class="text-sm" :style="{ fontFamily: fonts.body }">
            Body — <span class="text-gray-500 text-xs">{{ fonts.body || '—' }}</span>
          </p>
        </div>
      </div>

      <div>
        <h4 class="text-xs font-semibold text-gray-700 mb-2">
          Слайды ({{ slides.length }})
        </h4>
        <ul class="space-y-2">
          <li
            v-for="(slide, idx) in slides"
            :key="idx"
            class="border border-gray-200 rounded-lg px-3 py-2 text-xs space-y-1"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[10px] uppercase text-gray-400">#{{ idx + 1 }}</span>
              <span class="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{{ slide.layout }}</span>
              <span v-if="slide.background && slide.background !== 'none'" class="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">{{ slide.background }}</span>
              <span
                v-for="(d, di) in (slide.decor || [])"
                :key="di"
                class="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded"
              >
                {{ d }}
              </span>
            </div>
            <p v-if="slide.design_notes" class="text-gray-500">{{ slide.design_notes }}</p>
          </li>
        </ul>
      </div>
    </template>

    <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy"
        @click="confirm"
      >
        Запустить верстку →
      </button>
      <details class="ml-auto">
        <summary class="text-xs text-gray-500 cursor-pointer select-none">
          Перегенерировать дизайн
        </summary>
        <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <input
            v-model="regeneratePrompt"
            type="text"
            placeholder="Что изменить (опционально)"
            class="flex-1 px-2 py-1 border border-gray-200 rounded text-xs"
          />
          <button
            type="button"
            class="px-3 py-1.5 text-xs bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            :disabled="busy"
            @click="regenerate"
          >
            Перегенерировать
          </button>
        </div>
      </details>
    </div>
  </div>
</template>
