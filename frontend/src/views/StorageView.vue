<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import client from '../api/client'

const authToken = computed(() => {
  try {
    return window.localStorage.getItem('token') || ''
  } catch {
    return ''
  }
})

function fileUrl(id) {
  return `${client.defaults.baseURL}/files/attachment/${id}?token=${encodeURIComponent(authToken.value)}`
}

const loading = ref(false)
const error = ref('')
const q = ref('')
const type = ref('all')
const viewMode = ref('grid') // grid|list
const attachments = ref([])

const showUpload = ref(false)
const uploadFile = ref(null)
const uploadPrompt = ref('')
const uploading = ref(false)

const typeOptions = [
  { id: 'all', label: 'Все' },
  { id: 'image', label: 'Изображения' },
  { id: 'application', label: 'Документы' },
  { id: 'text', label: 'Текст' }
]

const filteredQuery = computed(() => ({
  q: q.value.trim() || undefined,
  type: type.value === 'all' ? undefined : type.value
}))

function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return ''
  const b = Number(bytes)
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`
}

function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}

async function fetchAttachments() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/attachments', { params: filteredQuery.value })
    attachments.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось загрузить хранилище'
  } finally {
    loading.value = false
  }
}

async function handleUpload() {
  if (!uploadFile.value) return
  uploading.value = true
  error.value = ''
  try {
    const fd = new FormData()
    fd.append('file', uploadFile.value)
    if (uploadPrompt.value.trim()) fd.append('prompt', uploadPrompt.value.trim())
    await client.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    showUpload.value = false
    uploadFile.value = null
    uploadPrompt.value = ''
    await fetchAttachments()
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось загрузить файл'
  } finally {
    uploading.value = false
  }
}

async function updatePrompt(a, value) {
  try {
    const { data } = await client.put(`/attachments/${a.id}`, { value })
    a.prompt = data.prompt
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось обновить промт'
  }
}

async function removeAttachment(a) {
  if (!confirm(`Удалить файл "${a.original_name}"?`)) return
  try {
    await client.delete(`/attachments/${a.id}`)
    attachments.value = attachments.value.filter((x) => x.id !== a.id)
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось удалить файл'
  }
}

onMounted(fetchAttachments)

let debounce = null
watch([q, type], () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(fetchAttachments, 250)
})
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-8">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Хранилище</h1>
        <p class="text-sm text-gray-500 mt-1">Вложения, которые можно переиспользовать в разных презентациях</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'"
        >
          {{ viewMode === 'grid' ? 'Список' : 'Сетка' }}
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          @click="showUpload = true"
        >
          Загрузить файл
        </button>
      </div>
    </div>

    <div class="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-col md:flex-row gap-3 md:items-center">
      <div class="flex-1">
        <input
          v-model="q"
          type="text"
          placeholder="Поиск по названию..."
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div class="flex items-center gap-2">
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
    </div>

    <div v-if="error" class="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
      {{ error }}
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <div v-else-if="!attachments.length" class="text-center py-16 text-gray-500">
      Пока нет файлов. Загрузите первый.
    </div>

    <div v-else :class="viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-3'">
      <div
        v-for="a in attachments"
        :key="a.id"
        :class="viewMode === 'grid'
          ? 'bg-white border border-gray-200 rounded-xl overflow-hidden'
          : 'bg-white border border-gray-200 rounded-xl p-4 flex gap-4 items-start'"
      >
        <div v-if="viewMode === 'grid'" class="h-36 bg-gray-50 flex items-center justify-center">
          <img
            v-if="isImage(a.mime_type)"
            class="max-h-36 max-w-full object-contain"
            :src="fileUrl(a.id)"
            :alt="a.original_name"
          />
          <div v-else class="text-gray-400 text-sm px-4 text-center">
            {{ a.mime_type || 'Файл' }}
          </div>
        </div>

        <div :class="viewMode === 'grid' ? 'p-4' : 'flex-1 min-w-0'">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium text-gray-900 truncate">{{ a.original_name }}</p>
              <p class="text-xs text-gray-400 mt-0.5">
                <span v-if="a.file_size">{{ formatSize(a.file_size) }}</span>
                <span v-if="a.used_in_jobs !== undefined" class="ml-2">Использован: {{ a.used_in_jobs }}</span>
              </p>
            </div>
            <button
              type="button"
              class="text-gray-400 hover:text-red-500"
              title="Удалить"
              @click="removeAttachment(a)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="mt-3">
            <label class="block text-xs font-medium text-gray-600 mb-1">Промт к файлу</label>
            <textarea
              :value="a.prompt || ''"
              rows="3"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Например: «Возьми как пример оформления таблиц» или «Вставь это как фон на обложку»"
              @change="updatePrompt(a, $event.target.value)"
            ></textarea>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showUpload" class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-xl shadow-lg w-full max-w-lg border border-gray-200">
        <div class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Загрузить файл</h2>
          <button class="text-gray-400 hover:text-gray-600" @click="showUpload = false">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="p-4 space-y-3">
          <input type="file" @change="uploadFile = $event.target.files?.[0] || null" />
          <textarea
            v-model="uploadPrompt"
            rows="3"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Опишите, как использовать этот файл (опционально)"
          ></textarea>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
              @click="showUpload = false"
            >
              Отмена
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="uploading || !uploadFile"
              @click="handleUpload"
            >
              {{ uploading ? 'Загружаем...' : 'Загрузить' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

