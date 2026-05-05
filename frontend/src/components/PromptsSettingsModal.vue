<script setup>
// PromptsSettingsModal — replaces the legacy single-prompt modal with a
// tabbed editor for the four staged-pipeline prompts. Save / Reset operate
// on the active tab independently, so users can tune each stage in isolation.
//
// On "Apply" it returns the LAYOUT prompt to the parent (CreateJobView keeps a
// single per-job override slot) — multi-stage per-job overrides will land in a
// follow-up if/when needed.

import { ref, watch, computed } from 'vue'
import client from '../api/client'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  currentPrompt: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'update:systemPrompt'])

const TABS = [
  { id: 'default_planning_prompt', label: 'Планирование' },
  { id: 'default_design_prompt', label: 'Дизайн' },
  { id: 'default_layout_prompt', label: 'Верстка' },
  { id: 'default_refine_prompt', label: 'Доработка' },
]

const activeTab = ref('default_layout_prompt')
const values = ref({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const currentValue = computed({
  get: () => values.value[activeTab.value] || '',
  set: (v) => {
    values.value = { ...values.value, [activeTab.value]: v }
  },
})

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/settings/prompts')
    values.value = { ...data }
    // Override layout prompt with the per-job value if the user has one set.
    if (props.currentPrompt) {
      values.value.default_layout_prompt = props.currentPrompt
    }
  } catch {
    error.value = 'Не удалось загрузить промты'
  } finally {
    loading.value = false
  }
}

async function saveAsDefault() {
  saving.value = true
  error.value = ''
  try {
    await client.put(`/settings/prompts/${activeTab.value}`, {
      value: currentValue.value,
    })
  } catch {
    error.value = 'Не удалось сохранить как дефолт'
  } finally {
    saving.value = false
  }
}

async function resetToDefault() {
  saving.value = true
  error.value = ''
  try {
    const { data } = await client.post(`/settings/prompts/${activeTab.value}/reset`)
    values.value = { ...values.value, [activeTab.value]: data.value }
  } catch {
    error.value = 'Не удалось сбросить'
  } finally {
    saving.value = false
  }
}

function applyAndClose() {
  // For backwards compatibility, emit the layout prompt as the per-job override.
  emit('update:systemPrompt', values.value.default_layout_prompt || '')
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadAll()
  },
)
</script>

<template>
  <teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      @click.self="close"
    >
      <div class="bg-white rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col">
        <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-gray-900">Системные промты</h2>
            <p class="text-xs text-gray-500">
              Отдельный промт для каждого этапа staged-пайплайна.
            </p>
          </div>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-600"
            @click="close"
          >
            <span class="sr-only">Закрыть</span>
            ✕
          </button>
        </div>

        <div class="border-b border-gray-100 px-5">
          <div class="flex gap-1">
            <button
              v-for="tab in TABS"
              :key="tab.id"
              type="button"
              :class="[
                'px-3 py-2 text-xs font-medium border-b-2 transition',
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

        <div class="px-5 pt-3 pb-4 flex-1 flex flex-col gap-3 overflow-hidden">
          <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            {{ error }}
          </div>

          <textarea
            v-model="currentValue"
            :readonly="loading"
            rows="14"
            class="flex-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Промт для этого этапа…"
          />

          <p class="text-[11px] text-gray-400">
            Каждый этап работает в своём контексте. Дефолты задают разделение задач, поэтому правьте осторожно.
          </p>
        </div>

        <div class="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 bg-gray-50">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
              :disabled="saving"
              @click="resetToDefault"
            >
              Сбросить к дефолту
            </button>
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
              :disabled="saving"
              @click="saveAsDefault"
            >
              Сохранить как дефолт
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-xs text-gray-600 rounded-lg hover:bg-gray-100"
              @click="close"
            >
              Закрыть
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              :disabled="loading"
              @click="applyAndClose"
            >
              Применить (для текущей задачи)
            </button>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>
