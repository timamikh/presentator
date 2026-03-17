<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import client from '../api/client'
import SlidePreview from '../components/SlidePreview.vue'
import LlmLogViewer from '../components/LlmLogViewer.vue'

const route = useRoute()
const job = ref(null)
const loading = ref(true)
const error = ref('')
let pollTimer = null

const isActive = computed(() =>
  job.value && (job.value.status === 'pending' || job.value.status === 'processing')
)

const statusConfig = {
  pending: { label: 'Ожидание', class: 'bg-yellow-100 text-yellow-800' },
  processing: { label: 'Обработка', class: 'bg-blue-100 text-blue-800' },
  done: { label: 'Готово', class: 'bg-green-100 text-green-800' },
  error: { label: 'Ошибка', class: 'bg-red-100 text-red-800' }
}

function getStatus(status) {
  return statusConfig[status] || { label: status, class: 'bg-gray-100 text-gray-800' }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function fetchJob() {
  try {
    const { data } = await client.get(`/jobs/${route.params.id}`)
    job.value = data
    if (!isActive.value && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  } catch (err) {
    error.value = err.response?.data?.detail || 'Не удалось загрузить задачу'
  } finally {
    loading.value = false
  }
}

async function downloadPptx() {
  try {
    const response = await client.get(`/jobs/${route.params.id}/download`, {
      responseType: 'blob'
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `presentation-${route.params.id}.pptx`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch {
    error.value = 'Не удалось скачать файл'
  }
}

onMounted(() => {
  fetchJob()
  pollTimer = setInterval(() => {
    if (isActive.value) fetchJob()
  }, 3000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <router-link to="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Назад к списку
    </router-link>

    <div v-if="loading" class="flex justify-center py-16">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <div v-else-if="error && !job" class="text-center py-16">
      <p class="text-red-600">{{ error }}</p>
    </div>

    <template v-else-if="job">
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div class="flex items-start justify-between gap-4 mb-4">
          <h1 class="text-xl font-bold text-gray-900 leading-snug">Задача #{{ job.id }}</h1>
          <span
            :class="getStatus(job.status).class"
            class="inline-block text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0"
          >
            {{ getStatus(job.status).label }}
          </span>
        </div>

        <p class="text-sm text-gray-700 whitespace-pre-wrap mb-3">{{ job.prompt }}</p>

        <p class="text-xs text-gray-400">Создано: {{ formatDate(job.created_at) }}</p>
      </div>

      <!-- Active: spinner -->
      <div v-if="isActive" class="flex flex-col items-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600 mb-4"></div>
        <p class="text-gray-500">
          {{ job.status === 'pending' ? 'Задача в очереди...' : 'Генерируем презентацию...' }}
        </p>
      </div>

      <!-- Done: slides + download -->
      <template v-if="job.status === 'done'">
        <div v-if="job.result_path" class="mb-6">
          <button
            @click="downloadPptx"
            class="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Скачать PPTX
          </button>
        </div>

        <SlidePreview v-if="job.slide_data" :slide-data="job.slide_data" />
      </template>

      <!-- Error -->
      <div
        v-if="job.status === 'error'"
        class="bg-red-50 border border-red-200 rounded-xl p-6 text-center"
      >
        <p class="text-red-700 font-medium mb-1">Ошибка при генерации</p>
        <p class="text-sm text-red-600">{{ job.error_message || 'Неизвестная ошибка' }}</p>
      </div>

      <LlmLogViewer
        :request="job.llm_request"
        :response="job.llm_response"
      />

      <div v-if="error" class="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
        {{ error }}
      </div>
    </template>
  </div>
</template>
