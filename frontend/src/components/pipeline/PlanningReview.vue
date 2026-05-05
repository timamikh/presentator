<script setup>
// PlanningReview — renders the LLM Planning output (slides + content blocks)
// with inline editing. Designed for `awaiting_planning_review` status.
//
// Editing is intentionally minimal (text inputs / textareas) — the goal is to
// let users tweak titles or block text before kicking off the Design stage.
// Structural edits (add/remove slides) are out of scope for the first cut.

import { ref, watch, computed } from 'vue'

const props = defineProps({
  planningResult: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'regenerate'])

const local = ref(null)
const regeneratePrompt = ref('')

watch(
  () => props.planningResult,
  (val) => {
    local.value = val ? JSON.parse(JSON.stringify(val)) : null
  },
  { immediate: true },
)

const slides = computed(() => local.value?.slides || [])

function updateBlockText(slideIdx, blockIdx, key, value) {
  const slide = slides.value[slideIdx]
  if (!slide) return
  const block = slide.blocks?.[blockIdx]
  if (!block) return
  block[key] = value
}

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
        Шаг 1. Структура и контент
      </h3>
      <p class="text-xs text-gray-500">
        Проверьте план презентации перед тем, как переходить к дизайну.
        Можно скорректировать заголовки и тексты вручную.
      </p>
    </div>

    <div v-if="!slides.length" class="text-xs text-gray-400">
      Нет данных планирования.
    </div>

    <div
      v-for="(slide, idx) in slides"
      :key="idx"
      class="border border-gray-200 rounded-lg p-3 space-y-2"
    >
      <div class="flex items-center justify-between">
        <span class="text-[11px] uppercase tracking-wide text-gray-400">
          Слайд {{ idx + 1 }}
        </span>
      </div>
      <input
        v-model="slide.title"
        type="text"
        placeholder="Заголовок"
        class="w-full px-2 py-1 border border-gray-200 rounded text-sm"
      />
      <input
        v-if="slide.subtitle !== undefined"
        v-model="slide.subtitle"
        type="text"
        placeholder="Подзаголовок"
        class="w-full px-2 py-1 border border-gray-200 rounded text-xs text-gray-700"
      />

      <div v-if="slide.blocks && slide.blocks.length" class="space-y-1.5">
        <div
          v-for="(block, bIdx) in slide.blocks"
          :key="bIdx"
          class="bg-gray-50 rounded p-2 text-xs flex gap-2"
        >
          <span class="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] uppercase font-medium text-gray-500 shrink-0">
            {{ block.type }}
          </span>
          <textarea
            v-if="block.text !== undefined"
            :value="block.text"
            rows="2"
            class="flex-1 px-2 py-1 border border-gray-200 rounded resize-y bg-white"
            @input="updateBlockText(idx, bIdx, 'text', $event.target.value)"
          />
          <span v-else-if="block.attachment_ref" class="flex-1 text-gray-500">
            ref: {{ block.attachment_ref }}
            <span v-if="block.caption">— {{ block.caption }}</span>
          </span>
          <span v-else class="flex-1 text-gray-400">
            {{ JSON.stringify(block) }}
          </span>
        </div>
      </div>

      <textarea
        v-if="slide.speaker_notes !== undefined"
        v-model="slide.speaker_notes"
        rows="2"
        placeholder="Заметки спикера"
        class="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-gray-50"
      />
    </div>

    <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy"
        @click="confirm"
      >
        Подтвердить и продолжить →
      </button>
      <details class="ml-auto">
        <summary class="text-xs text-gray-500 cursor-pointer select-none">
          Перегенерировать структуру
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
