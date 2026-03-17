<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import client from '../api/client'

const authToken = computed(() => {
  try { return window.localStorage.getItem('token') || '' } catch { return '' }
})

function fileUrl(id) {
  return `${client.defaults.baseURL}/files/attachment/${id}?token=${encodeURIComponent(authToken.value)}`
}

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const loading = ref(false)
const error = ref('')
const q = ref('')
const type = ref('all')
const attachments = ref([])
const picked = ref(new Set())

const typeOptions = [
  { id: 'all', label: 'Все' },
  { id: 'image', label: 'Изображения' },
  { id: 'application', label: 'Документы' },
  { id: 'text', label: 'Текст' }
]

const params = computed(() => ({
  q: q.value.trim() || undefined,
  type: type.value === 'all' ? undefined : type.value
}))

function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}

async function fetchAttachments() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/attachments', { params: params.value })
    attachments.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось загрузить хранилище'
  } finally {
    loading.value = false
  }
}

function toggle(id) {
  if (picked.value.has(id)) picked.value.delete(id)
  else picked.value.add(id)
}

function close() {
  emit('update:modelValue', false)
}

function confirm() {
  const selected = attachments.value.filter((a) => picked.value.has(a.id))
  emit('confirm', selected)
  close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      picked.value = new Set(props.selectedIds || [])
      fetchAttachments()
    }
  }
)

let debounce = null
watch([q, type], () => {
  if (!props.modelValue) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(fetchAttachments, 250)
})

onMounted(() => {
  if (props.modelValue) fetchAttachments()
})
</script>

<template>
  <div v-if="modelValue" class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
    <div class="bg-white rounded-xl shadow-lg w-full max-w-3xl border border-gray-200 overflow-hidden">
      <div class="p-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 class="font-semibold text-gray-900">Добавить из хранилища</h2>
          <p class="text-xs text-gray-500 mt-0.5">Выберите файлы, которые хотите прикрепить</p>
        </div>
        <button class="text-gray-400 hover:text-gray-600" @click="close">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="p-4 border-b border-gray-200 flex flex-col md:flex-row gap-3 md:items-center">
        <input
          v-model="q"
          type="text"
          placeholder="Поиск..."
          class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          v-model="type"
          class="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option v-for="t in typeOptions" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          :disabled="loading"
          @click="fetchAttachments"
        >
          Обновить
        </button>
      </div>

      <div v-if="error" class="m-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
        {{ error }}
      </div>

      <div class="p-4 max-h-[60vh] overflow-auto">
        <div v-if="loading" class="flex justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>

        <div v-else-if="!attachments.length" class="text-center py-12 text-gray-500">
          Нет файлов по выбранным фильтрам
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            v-for="a in attachments"
            :key="a.id"
            type="button"
            class="text-left border rounded-xl overflow-hidden hover:border-blue-300 transition"
            :class="picked.has(a.id) ? 'border-blue-600 ring-2 ring-blue-100' : 'border-gray-200'"
            @click="toggle(a.id)"
          >
            <div class="h-24 bg-gray-50 flex items-center justify-center">
              <img
                v-if="isImage(a.mime_type)"
                class="max-h-24 max-w-full object-contain"
                :src="fileUrl(a.id)"
                :alt="a.original_name"
              />
              <div v-else class="text-gray-400 text-xs px-4 text-center">
                {{ a.mime_type || 'Файл' }}
              </div>
            </div>
            <div class="p-3">
              <div class="flex items-start justify-between gap-2">
                <p class="font-medium text-gray-900 text-sm truncate">{{ a.original_name }}</p>
                <span
                  class="text-[10px] px-2 py-0.5 rounded-full"
                  :class="picked.has(a.id) ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'"
                >
                  {{ picked.has(a.id) ? 'Выбрано' : 'Выбрать' }}
                </span>
              </div>
              <p class="text-xs text-gray-500 mt-1 max-h-10 overflow-hidden">
                {{ a.prompt || 'Без промта' }}
              </p>
            </div>
          </button>
        </div>
      </div>

      <div class="p-4 border-t border-gray-200 flex items-center justify-end gap-2">
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          @click="close"
        >
          Отмена
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          :disabled="picked.size === 0"
          @click="confirm"
        >
          Добавить ({{ picked.size }})
        </button>
      </div>
    </div>
  </div>
</template>

