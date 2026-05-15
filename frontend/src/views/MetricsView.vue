<script setup>
// Metrics dashboard. Shows aggregated LLM usage across the user's jobs:
//   • Summary cards (calls / tokens / latency / errors)
//   • Stacked bar chart by day (prompt vs completion tokens)
//   • Doughnut chart by stage (planning / design / layout / refine)
//   • Recent calls table
//
// Range is selectable: 7 / 30 / 90 days. All series come from
// /api/metrics/* — see api-service/src/routes/metrics.js.

import { ref, computed, onMounted, watch } from 'vue'
import { Bar, Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
} from 'chart.js'
import client from '../api/client'

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
)

const days = ref(30)
const loading = ref(true)
const error = ref('')

const summary = ref({
  total_calls: 0,
  total_prompt_tokens: 0,
  total_completion_tokens: 0,
  total_tokens: 0,
  avg_latency_ms: 0,
  total_jobs: 0,
  error_calls: 0,
})
const byStage = ref([])
const byDay = ref([])
const byModel = ref([])
const recentCalls = ref([])

const STAGE_LABELS = {
  planning: 'Планирование',
  design: 'Дизайн',
  layout: 'Верстка',
  refine_layout: 'Доработка',
}

function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage
}

function fmtNum(n) {
  if (typeof n !== 'number') return '0'
  return n.toLocaleString('ru-RU')
}

function fmtTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const byDayChartData = computed(() => ({
  labels: byDay.value.map((r) => r.day),
  datasets: [
    {
      label: 'Prompt',
      data: byDay.value.map((r) => r.prompt_tokens),
      backgroundColor: '#3b82f6',
    },
    {
      label: 'Completion',
      data: byDay.value.map((r) => r.completion_tokens),
      backgroundColor: '#10b981',
    },
  ],
}))

const byDayChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('ru-RU')} токенов`,
      },
    },
  },
  scales: {
    x: { stacked: true, grid: { display: false } },
    y: { stacked: true, beginAtZero: true },
  },
}

const STAGE_COLORS = {
  planning: '#3b82f6',
  design: '#a855f7',
  layout: '#22c55e',
  refine_layout: '#f59e0b',
}

const byStageChartData = computed(() => {
  const rows = byStage.value
  return {
    labels: rows.map((r) => stageLabel(r.stage)),
    datasets: [
      {
        data: rows.map((r) => r.total_tokens),
        backgroundColor: rows.map((r) => STAGE_COLORS[r.stage] || '#9ca3af'),
        borderWidth: 0,
      },
    ],
  }
})

const byStageChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.label}: ${ctx.parsed.toLocaleString('ru-RU')} токенов`,
      },
    },
  },
}

async function fetchAll() {
  loading.value = true
  error.value = ''
  try {
    const [s, st, d, m, recent] = await Promise.all([
      client.get('/metrics/summary', { params: { days: days.value } }),
      client.get('/metrics/by-stage', { params: { days: days.value } }),
      client.get('/metrics/by-day', { params: { days: days.value } }),
      client.get('/metrics/by-model', { params: { days: days.value } }),
      client.get('/metrics/recent-calls', { params: { limit: 50 } }),
    ])
    summary.value = s.data.summary
    byStage.value = st.data.rows
    byDay.value = d.data.rows
    byModel.value = m.data.rows
    recentCalls.value = recent.data.rows
  } catch (err) {
    error.value = err.response?.data?.error || err.message || 'Не удалось загрузить метрики'
  } finally {
    loading.value = false
  }
}

watch(days, () => fetchAll())
onMounted(() => fetchAll())
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Метрики и токены</h1>
        <p class="text-sm text-gray-500 mt-1">
          Сырые логи и агрегированная статистика по всем LLM-вызовам
        </p>
      </div>
      <div class="flex items-center gap-2">
        <label for="rng" class="text-sm text-gray-600">Период:</label>
        <select
          id="rng"
          v-model.number="days"
          class="border border-gray-300 rounded-lg text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option :value="7">7 дней</option>
          <option :value="30">30 дней</option>
          <option :value="90">90 дней</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <div v-else-if="error" class="text-center py-16 text-red-600">
      {{ error }}
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <p class="text-xs uppercase tracking-wider text-gray-500">Всего токенов</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{{ fmtNum(summary.total_tokens) }}</p>
          <p class="text-xs text-gray-400 mt-1">
            prompt {{ fmtNum(summary.total_prompt_tokens) }} ·
            completion {{ fmtNum(summary.total_completion_tokens) }}
          </p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <p class="text-xs uppercase tracking-wider text-gray-500">LLM-вызовов</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{{ fmtNum(summary.total_calls) }}</p>
          <p class="text-xs text-gray-400 mt-1">по {{ fmtNum(summary.total_jobs) }} задачам</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <p class="text-xs uppercase tracking-wider text-gray-500">Средняя задержка</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{{ fmtNum(summary.avg_latency_ms) }} мс</p>
          <p class="text-xs text-gray-400 mt-1">end-to-end LLM</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <p class="text-xs uppercase tracking-wider text-gray-500">Ошибок</p>
          <p
            class="text-2xl font-bold mt-1"
            :class="summary.error_calls > 0 ? 'text-red-600' : 'text-gray-900'"
          >
            {{ fmtNum(summary.error_calls) }}
          </p>
          <p class="text-xs text-gray-400 mt-1">из {{ fmtNum(summary.total_calls) }} вызовов</p>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div class="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <h2 class="text-sm font-semibold text-gray-700 mb-3">Токены по дням</h2>
          <div class="h-72">
            <Bar
              v-if="byDay.length > 0"
              :data="byDayChartData"
              :options="byDayChartOptions"
            />
            <div v-else class="h-full flex items-center justify-center text-sm text-gray-400">
              Нет данных за период
            </div>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <h2 class="text-sm font-semibold text-gray-700 mb-3">Токены по этапам</h2>
          <div class="h-72">
            <Doughnut
              v-if="byStage.length > 0"
              :data="byStageChartData"
              :options="byStageChartOptions"
            />
            <div v-else class="h-full flex items-center justify-center text-sm text-gray-400">
              Нет данных за период
            </div>
          </div>
        </div>
      </div>

      <!-- By stage table -->
      <div class="bg-white rounded-xl border border-gray-200 p-4 mb-8">
        <h2 class="text-sm font-semibold text-gray-700 mb-3">Сводка по этапам</h2>
        <div v-if="byStage.length === 0" class="text-sm text-gray-400 py-4">
          Нет данных за период
        </div>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
              <th class="py-2">Этап</th>
              <th class="py-2">Вызовы</th>
              <th class="py-2">Prompt</th>
              <th class="py-2">Completion</th>
              <th class="py-2">Всего</th>
              <th class="py-2">Avg latency</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in byStage" :key="r.stage" class="border-b border-gray-100">
              <td class="py-2">{{ stageLabel(r.stage) }}</td>
              <td class="py-2">{{ fmtNum(r.total_calls) }}</td>
              <td class="py-2">{{ fmtNum(r.prompt_tokens) }}</td>
              <td class="py-2">{{ fmtNum(r.completion_tokens) }}</td>
              <td class="py-2 font-medium">{{ fmtNum(r.total_tokens) }}</td>
              <td class="py-2">{{ fmtNum(r.avg_latency_ms) }} мс</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- By model table -->
      <div v-if="byModel.length > 0" class="bg-white rounded-xl border border-gray-200 p-4 mb-8">
        <h2 class="text-sm font-semibold text-gray-700 mb-3">Сводка по моделям</h2>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
              <th class="py-2">Модель</th>
              <th class="py-2">Вызовы</th>
              <th class="py-2">Всего токенов</th>
              <th class="py-2">Avg latency</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in byModel" :key="r.model" class="border-b border-gray-100">
              <td class="py-2 font-mono text-xs">{{ r.model }}</td>
              <td class="py-2">{{ fmtNum(r.total_calls) }}</td>
              <td class="py-2 font-medium">{{ fmtNum(r.total_tokens) }}</td>
              <td class="py-2">{{ fmtNum(r.avg_latency_ms) }} мс</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Recent calls -->
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <h2 class="text-sm font-semibold text-gray-700 mb-3">Последние вызовы</h2>
        <div v-if="recentCalls.length === 0" class="text-sm text-gray-400 py-4">
          Пока нет вызовов
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th class="py-2">Время</th>
                <th class="py-2">Этап</th>
                <th class="py-2">Модель</th>
                <th class="py-2">Prompt</th>
                <th class="py-2">Completion</th>
                <th class="py-2">Latency</th>
                <th class="py-2">Статус</th>
                <th class="py-2">Задача</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in recentCalls" :key="r.id" class="border-b border-gray-100">
                <td class="py-2 text-gray-600">{{ fmtTime(r.created_at) }}</td>
                <td class="py-2">{{ stageLabel(r.stage) }}</td>
                <td class="py-2 font-mono text-xs">{{ r.model }}</td>
                <td class="py-2">{{ fmtNum(r.prompt_tokens) }}</td>
                <td class="py-2">{{ fmtNum(r.completion_tokens) }}</td>
                <td class="py-2">{{ fmtNum(r.latency_ms) }} мс</td>
                <td class="py-2">
                  <span
                    v-if="r.error_message"
                    class="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                    :title="r.error_message"
                  >
                    ошибка
                  </span>
                  <span
                    v-else
                    class="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"
                  >
                    ok
                  </span>
                </td>
                <td class="py-2">
                  <router-link
                    v-if="r.job_id"
                    :to="`/jobs/${r.job_id}`"
                    class="text-blue-600 hover:underline text-xs"
                  >
                    открыть
                  </router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
