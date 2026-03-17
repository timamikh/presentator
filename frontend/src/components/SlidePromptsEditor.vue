<script setup>
const props = defineProps({
  slideCount: {
    type: Number,
    default: 0
  },
  modelValue: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])

function updatePrompt(index, value) {
  const next = Array.from({ length: props.slideCount }, (_v, i) => {
    const existing = props.modelValue.find((p) => p.slideIndex === i)
    return {
      slideIndex: i,
      prompt: i === index ? value : existing?.prompt || ''
    }
  })
  emit('update:modelValue', next)
}
</script>

<template>
  <div v-if="slideCount > 0" class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-900">Промты по слайдам</h2>
      <span class="text-xs text-gray-400">
        {{ slideCount }} {{ slideCount === 1 ? 'слайд' : 'слайдов' }}
      </span>
    </div>

    <div class="max-h-72 overflow-y-auto pr-1 space-y-2">
      <div
        v-for="index in slideCount"
        :key="index"
        class="border border-gray-100 rounded-lg p-3 bg-gray-50/60"
      >
        <p class="text-xs font-medium text-gray-700 mb-1">
          Слайд {{ index }}
        </p>
        <textarea
          :value="modelValue.find((p) => p.slideIndex === index - 1)?.prompt || ''"
          @input="updatePrompt(index - 1, $event.target.value)"
          rows="2"
          class="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none bg-white"
          placeholder="Что должно быть на этом слайде..."
        ></textarea>
      </div>
    </div>
  </div>
</template>

