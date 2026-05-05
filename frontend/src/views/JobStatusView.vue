<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import client from '../api/client'
import SlidePreview from '../components/SlidePreview.vue'
import LlmLogViewer from '../components/LlmLogViewer.vue'
import PipelineStepper from '../components/pipeline/PipelineStepper.vue'
import PlanningReview from '../components/pipeline/PlanningReview.vue'
import DesignReview from '../components/pipeline/DesignReview.vue'
import RefinementPanel from '../components/pipeline/RefinementPanel.vue'

const route = useRoute()
const job = ref(null)
const steps = ref([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
let pollTimer = null

const isV2 = computed(() => job.value?.pipeline_version === 2)

const isActive = computed(() =>
  job.value && [
    'pending',
    'processing',
    'processing_planning',
    'processing_design',
    'processing_layout',
    'processing_refine',
  ].includes(job.value.status),
)

const statusConfig = {
  pending: { label: 'Ожидание', class: 'bg-yellow-100 text-yellow-800' },
  processing: { label: 'Обработка', class: 'bg-blue-100 text-blue-800' },
  processing_planning: { label: 'Планирование', class: 'bg-blue-100 text-blue-800' },
  processing_design: { label: 'Дизайн', class: 'bg-blue-100 text-blue-800' },
  processing_layout: { label: 'Верстка', class: 'bg-blue-100 text-blue-800' },
  processing_refine: { label: 'Доработка', class: 'bg-blue-100 text-blue-800' },
  awaiting_planning_review: { label: 'Ожидает подтверждения структуры', class: 'bg-amber-100 text-amber-800' },
  awaiting_design_review: { label: 'Ожидает подтверждения дизайна', class: 'bg-amber-100 text-amber-800' },
  done: { label: 'Готово', class: 'bg-green-100 text-green-800' },
  error: { label: 'Ошибка', class: 'bg-red-100 text-red-800' },
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
    minute: '2-digit',
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
    error.value = err.response?.data?.error || err.response?.data?.detail || 'Не удалось загрузить задачу'
  } finally {
    loading.value = false
  }
}

async function fetchSteps() {
  try {
    const { data } = await client.get(`/jobs/${route.params.id}/steps`)
    steps.value = Array.isArray(data) ? data : []
  } catch {
    steps.value = []
  }
}

async function startStage(stage, body = {}) {
  busy.value = true
  error.value = ''
  try {
    await client.post(`/jobs/${route.params.id}/stages/${stage}/start`, body)
    await fetchJob()
    await fetchSteps()
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (isActive.value) {
          fetchJob()
          fetchSteps()
        }
      }, 3000)
    }
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось запустить этап'
  } finally {
    busy.value = false
  }
}

async function refine({ prompt, slideIndex }) {
  busy.value = true
  error.value = ''
  try {
    await client.post(`/jobs/${route.params.id}/refine`, { prompt, slideIndex })
    await fetchJob()
    await fetchSteps()
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (isActive.value) {
          fetchJob()
          fetchSteps()
        }
      }, 3000)
    }
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось запустить доработку'
  } finally {
    busy.value = false
  }
}

async function downloadFile(format) {
  try {
    const response = await client.get(`/jobs/${route.params.id}/download?format=${format}`, {
      responseType: 'blob',
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

const layoutAttempts = computed(() =>
  steps.value
    .filter((s) => s.stage === 'layout' || s.stage === 'refine_layout')
    .sort((a, b) => new Date(a.completed_at || 0) - new Date(b.completed_at || 0)),
)

onMounted(() => {
  fetchJob().then(fetchSteps)
  pollTimer = setInterval(() => {
    if (isActive.value) {
      fetchJob()
      fetchSteps()
    }
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

      <PipelineStepper
        v-if="isV2"
        :status="job.status"
        :current-stage="job.current_stage"
        class="mb-6"
      />

      <!-- Stage 1 review -->
      <PlanningReview
        v-if="isV2 && job.status === 'awaiting_planning_review'"
        :planning-result="job.planning_result"
        :busy="busy"
        class="mb-6"
        @confirm="(planningResult) => startStage('design', { planning_result: planningResult })"
        @regenerate="(prompt) => startStage('planning', prompt ? { refinePrompt: prompt } : {})"
      />

      <!-- Stage 2 review -->
      <DesignReview
        v-if="isV2 && job.status === 'awaiting_design_review'"
        :design-brief="job.design_brief"
        :busy="busy"
        class="mb-6"
        @confirm="(designBrief) => startStage('layout', { design_brief: designBrief })"
        @regenerate="(prompt) => startStage('design', prompt ? { refinePrompt: prompt } : {})"
      />

      <!-- Active progress -->
      <div v-if="isActive && !['awaiting_planning_review', 'awaiting_design_review'].includes(job.status)" class="flex flex-col items-center py-12">
        <div class="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600 mb-4"></div>
        <p class="text-gray-500">
          {{ getStatus(job.status).label }}…
        </p>
      </div>

      <!-- Done: slides + downloads + refinement -->
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

        <SlidePreview
          v-if="job.slide_data"
          :slide-data="job.slide_data"
          :attachments="job.attachments || []"
          class="mb-6"
        />

        <RefinementPanel
          v-if="isV2"
          :slide-count="(job.slide_data && job.slide_data.slides) ? job.slide_data.slides.length : 0"
          :busy="busy"
          class="mb-6"
          @refine="refine"
        />

        <details v-if="isV2 && layoutAttempts.length > 1" class="mb-6 bg-white rounded-xl border border-gray-200 p-3">
          <summary class="text-xs font-medium text-gray-700 cursor-pointer select-none">
            История версий ({{ layoutAttempts.length }})
          </summary>
          <ul class="mt-2 space-y-1 text-xs text-gray-500">
            <li v-for="(s, i) in layoutAttempts" :key="i">
              {{ s.stage }} #{{ s.attempt }} — {{ s.status }}{{ s.completed_at ? ' · ' + formatDate(s.completed_at) : '' }}
            </li>
          </ul>
        </details>
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
