<script setup>
import { ref, watch, onMounted } from 'vue'
import client from '../api/client'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  currentPrompt: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'update:systemPrompt'])

const value = ref('')
const loading = ref(false)
const error = ref('')
const savingDefault = ref(false)

async function loadDefault() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/settings/system-prompt')
    value.value = data.value || ''
  } catch {
    error.value = 'Не удалось загрузить системный промт'
  } finally {
    loading.value = false
  }
}

async function saveAsDefault() {
  savingDefault.value = true
  error.value = ''
  try {
    await client.put('/settings/system-prompt', { value: value.value })
  } catch {
    error.value = 'Не удалось сохранить промт по умолчанию'
  } finally {
    savingDefault.value = false
  }
}

function applyAndClose() {
  emit('update:systemPrompt', value.value)
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      value.value = props.currentPrompt || ''
      if (!value.value) {
        loadDefault()
      }
    }
  }
)

onMounted(() => {
  if (props.modelValue && !value.value) {
    loadDefault()
  }
})
</script>

<template>
  <teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      @click.self="close"
    >
      <div class="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-gray-900">Системный промт</h2>
            <p class="text-xs text-gray-500">
              Влияет на стиль и структуру всей презентации.
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

        <div class="px-5 pt-3 pb-4 flex-1 flex flex-col gap-3 overflow-hidden">
          <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            {{ error }}
          </div>

          <textarea
            v-model="value"
            :readonly="loading"
            rows="10"
            class="flex-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Опишите поведение и стиль LLM для генерации презентаций..."
          ></textarea>

          <p class="text-[11px] text-gray-400">
            Рекомендуется описать формат JSON, ограничения по количеству слайдов, стиль текста и язык ответа.
          </p>
        </div>

        <div class="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 bg-gray-50">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
              @click="loadDefault"
            >
              Сбросить к дефолту
            </button>
            <button
              type="button"
              class="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline disabled:opacity-50"
              :disabled="savingDefault"
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
              Отмена
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              :disabled="loading"
              @click="applyAndClose"
            >
              Применить
            </button>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

