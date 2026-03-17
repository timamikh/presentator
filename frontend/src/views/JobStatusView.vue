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
const revisions = ref([])
const revisionsLoading = ref(false)
const revisionError = ref('')
const refinementMessage = ref('')
const refining = ref(false)
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
    error.value = err.response?.data?.error || 'Не удалось загрузить задачу'
  } finally {
    loading.value = false
  }
}

async function fetchRevisions() {
  revisionsLoading.value = true
  revisionError.value = ''
  try {
    const { data } = await client.get(`/jobs/${route.params.id}/revisions`)
    revisions.value = Array.isArray(data) ? data : []
  } catch (err) {
    revisionError.value = err.response?.data?.error || 'Не удалось загрузить версии'
  } finally {
    revisionsLoading.value = false
  }
}

function ensurePolling() {
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      if (isActive.value) fetchJob()
    }, 3000)
  }
}

async function startRefinement() {
  const message = refinementMessage.value.trim()
  if (!message) return
  refining.value = true
  revisionError.value = ''
  try {
    await client.post(`/jobs/${route.params.id}/revisions`, { message })
    refinementMessage.value = ''
    await fetchJob()
    await fetchRevisions()
    ensurePolling()
  } catch (err) {
    revisionError.value = err.response?.data?.error || 'Не удалось запустить доработку'
  } finally {
    refining.value = false
  }
}

async function restoreRevision(rev) {
  if (!confirm(`Восстановить версию ${rev}?`)) return
  revisionError.value = ''
  try {
    await client.post(`/jobs/${route.params.id}/revisions/${rev}/restore`)
    await fetchJob()
    await fetchRevisions()
  } catch (err) {
    revisionError.value = err.response?.data?.error || 'Не удалось восстановить версию'
  }
}

async function downloadFile(format) {
  try {
    const response = await client.get(`/jobs/${route.params.id}/download?format=${format}`, {
      responseType: 'blob'
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `presentation-${route.params.id}.${format}`)
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
  fetchRevisions()
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
        <div v-if="job.result_path || job.result_paths" class="mb-6 flex flex-wrap gap-3">
          <button
            @click="downloadFile('pdf')"
            class="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Скачать PDF
          </button>
          <button
            @click="downloadFile('pptx')"
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

        <div class="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)] gap-6">
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 class="font-semibold text-gray-900">Продолжить редактирование</h2>
            <p class="text-sm text-gray-500 mt-1">
              Опишите, что нужно изменить. Мы отправим в модель полный текущий контекст презентации.
            </p>
            <textarea
              v-model="refinementMessage"
              rows="4"
              class="mt-3 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Например: «Добавь слайд с итогами», «Сделай стиль более минималистичным», «Вставь логотип на обложку»..."
            ></textarea>
            <div class="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                class="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                :disabled="refining || !refinementMessage.trim()"
                @click="startRefinement"
              >
                {{ refining ? 'Отправляем...' : 'Уточнить' }}
              </button>
            </div>
            <p v-if="revisionError" class="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {{ revisionError }}
            </p>
          </div>

          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div class="flex items-center justify-between gap-3">
              <h2 class="font-semibold text-gray-900">История версий</h2>
              <button
                type="button"
                class="text-xs text-gray-500 hover:text-gray-700"
                :disabled="revisionsLoading"
                @click="fetchRevisions"
              >
                Обновить
              </button>
            </div>

            <div v-if="revisionsLoading" class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600"></div>
            </div>

            <div v-else-if="!revisions.length" class="text-sm text-gray-500 py-6">
              Пока нет сохранённых версий. Первая появится после первого уточнения.
            </div>

            <ul v-else class="mt-3 space-y-2">
              <li
                v-for="r in revisions"
                :key="r.revision_number"
                class="border border-gray-200 rounded-lg p-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-gray-900">Версия {{ r.revision_number }}</p>
                    <p v-if="r.user_message" class="text-xs text-gray-500 mt-1 max-h-10 overflow-hidden">
                      {{ r.user_message }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50"
                    @click="restoreRevision(r.revision_number)"
                  >
                    Восстановить
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
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
