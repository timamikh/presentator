<script setup>
// RefinementPanel — appears under SlidePreview when status === 'done'.
// Lets the user kick off a new layout pass either for a single slide
// (slideIndex) or for the whole presentation. Server creates a new
// job_pipeline_steps row with attempt = max+1, so history stays intact.

import { ref, computed } from 'vue'

const props = defineProps({
  slideCount: { type: Number, default: 0 },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['refine'])

const mode = ref('all') // 'all' | 'one'
const slideIndex = ref(0)
const prompt = ref('')

const slideOptions = computed(() => {
  return Array.from({ length: props.slideCount }, (_, i) => i)
})

function submit() {
  const text = prompt.value.trim()
  if (!text) return
  emit('refine', {
    prompt: text,
    slideIndex: mode.value === 'one' ? Number(slideIndex.value) : null,
  })
  prompt.value = ''
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
    <h3 class="text-sm font-semibold text-gray-900">Доработать презентацию</h3>
    <p class="text-xs text-gray-500">
      Опишите, что изменить — модель применит изменения к выбранным слайдам и
      пересоберёт PDF / PPTX.
    </p>

    <div class="flex gap-2">
      <button
        type="button"
        :class="[
          'px-3 py-1.5 text-xs rounded-lg border',
          mode === 'all'
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-gray-200 hover:border-gray-300'
        ]"
        @click="mode = 'all'"
      >
        Всю презентацию
      </button>
      <button
        type="button"
        :class="[
          'px-3 py-1.5 text-xs rounded-lg border',
          mode === 'one'
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-gray-200 hover:border-gray-300'
        ]"
        :disabled="!slideOptions.length"
        @click="mode = 'one'"
      >
        Один слайд
      </button>
      <select
        v-if="mode === 'one'"
        v-model="slideIndex"
        class="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
      >
        <option v-for="i in slideOptions" :key="i" :value="i">
          Слайд {{ i + 1 }}
        </option>
      </select>
    </div>

    <textarea
      v-model="prompt"
      rows="3"
      placeholder="Например: добавь крупный заголовок, увеличь акцент на цифрах, замени цвет фона на тёмный…"
      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
    />

    <div class="flex justify-end">
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy || !prompt.trim()"
        @click="submit"
      >
        Применить доработку
      </button>
    </div>
  </div>
</template>
