<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  request: {
    type: Object,
    default: null
  },
  response: {
    type: Object,
    default: null
  }
})

const open = ref(false)

const hasData = computed(() => !!props.request || !!props.response)

function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj ?? '')
  }
}
</script>

<template>
  <div v-if="hasData" class="mt-6">
    <button
      type="button"
      class="inline-flex items-center gap-2 text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 border border-gray-200 rounded-full bg-white/80 shadow-sm"
      @click="open = !open"
    >
      <svg
        class="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M11.25 4.5l-7.5 7.5 7.5 7.5m9-15l-7.5 7.5 7.5 7.5"
        />
      </svg>
      <span>Показать логи LLM</span>
      <span
        class="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full bg-gray-800 text-white"
      >
        i
      </span>
    </button>

    <div
      v-if="open"
      class="mt-3 border border-gray-200 rounded-xl bg-gray-50/80 text-xs text-gray-800 overflow-hidden"
    >
      <div class="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
        <div class="p-3 space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-gray-800">Запрос к LLM</h3>
            <span class="text-[10px] text-gray-400 uppercase tracking-wide">
              request
            </span>
          </div>
          <pre class="max-h-64 overflow-auto bg-white rounded border border-gray-100 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
{{ pretty(request) }}
          </pre>
        </div>

        <div class="p-3 space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-gray-800">Ответ от LLM</h3>
            <span class="text-[10px] text-gray-400 uppercase tracking-wide">
              response
            </span>
          </div>
          <pre class="max-h-64 overflow-auto bg-white rounded border border-gray-100 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
{{ pretty(response) }}
          </pre>
        </div>
      </div>
    </div>
  </div>
</template>

