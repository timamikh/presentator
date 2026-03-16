<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import client from '../api/client'

const router = useRouter()
const jobs = ref([])
const loading = ref(true)
const error = ref('')
let pollTimer = null

const hasActiveJobs = computed(() =>
  jobs.value.some((j) => j.status === 'pending' || j.status === 'processing')
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

function truncate(text, maxLen = 60) {
  if (!text) return '—'
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function fetchJobs() {
  try {
    const { data } = await client.get('/jobs')
    jobs.value = data
  } catch (err) {
    error.value = err.response?.data?.detail || 'Не удалось загрузить список'
  } finally {
    loading.value = false
  }
}

function startPolling() {
  pollTimer = setInterval(() => {
    if (hasActiveJobs.value) fetchJobs()
  }, 5000)
}

onMounted(() => {
  fetchJobs()
  startPolling()
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Мои презентации</h1>
      <router-link
        to="/create"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Создать презентацию
      </router-link>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <div v-else-if="error" class="text-center py-16">
      <p class="text-red-600">{{ error }}</p>
      <button @click="fetchJobs" class="mt-3 text-sm text-blue-600 hover:underline">
        Повторить
      </button>
    </div>

    <div v-else-if="jobs.length === 0" class="text-center py-16">
      <div class="text-5xl mb-4">&#128196;</div>
      <p class="text-gray-500 text-lg">У вас пока нет презентаций</p>
      <router-link to="/create" class="mt-3 inline-block text-sm text-blue-600 hover:underline">
        Создать первую
      </router-link>
    </div>

    <div v-else class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-200 bg-gray-50">
            <th class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
              Описание
            </th>
            <th class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
              Статус
            </th>
            <th class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">
              Дата
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="job in jobs"
            :key="job.id"
            @click="router.push(`/jobs/${job.id}`)"
            class="hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <td class="px-4 py-3 text-sm text-gray-900">
              {{ truncate(job.prompt) }}
            </td>
            <td class="px-4 py-3">
              <span
                :class="getStatus(job.status).class"
                class="inline-block text-xs font-medium px-2.5 py-0.5 rounded-full"
              >
                {{ getStatus(job.status).label }}
              </span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-500">
              {{ formatDate(job.created_at) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
