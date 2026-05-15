<script setup>
// Versions panel for /jobs/:id.
//
// Lists all snapshots of a job (auto + manual + restore-points) and lets the
// user:
//   • Save the current state as a manual snapshot.
//   • Restore any previous version (writes a follow-up "restore" snapshot so
//     history remains linear).
//
// Backed by /api/jobs/:id/snapshots (api-service/src/routes/snapshots.js).

import { ref, computed, onMounted, watch } from 'vue'
import client from '../api/client'
import {
  fmtTimestamp as fmtDate,
  stageLabel,
  kindBadge,
} from '../utils/formatters'
import { sortSnapshotsByVersionDesc } from '../utils/metricsChart'

const props = defineProps({
  jobId: { type: String, required: true },
})

const emit = defineEmits(['restored'])

const snapshots = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const manualLabel = ref('')
const showCreate = ref(false)
const confirmingVersion = ref(null)

const sortedSnapshots = computed(() => sortSnapshotsByVersionDesc(snapshots.value))

async function fetchSnapshots() {
  if (!props.jobId) return
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get(`/jobs/${props.jobId}/snapshots`)
    snapshots.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось загрузить версии'
  } finally {
    loading.value = false
  }
}

async function createManualSnapshot() {
  busy.value = true
  error.value = ''
  try {
    await client.post(`/jobs/${props.jobId}/snapshots`, { label: manualLabel.value || null })
    manualLabel.value = ''
    showCreate.value = false
    await fetchSnapshots()
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось создать снимок'
  } finally {
    busy.value = false
  }
}

async function restore(version) {
  busy.value = true
  error.value = ''
  try {
    await client.post(`/jobs/${props.jobId}/snapshots/${version}/restore`)
    confirmingVersion.value = null
    await fetchSnapshots()
    emit('restored', version)
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось откатить'
  } finally {
    busy.value = false
  }
}

watch(() => props.jobId, fetchSnapshots)
onMounted(fetchSnapshots)
defineExpose({ refresh: fetchSnapshots })
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-700">История версий</h3>
        <p class="text-xs text-gray-400">
          После каждого успешного этапа создаётся снимок. Можно откатить задачу к любой версии.
        </p>
      </div>
      <button
        type="button"
        class="text-xs text-blue-600 hover:text-blue-700 font-medium"
        @click="showCreate = !showCreate"
      >
        {{ showCreate ? 'Скрыть' : '+ Сохранить версию' }}
      </button>
    </div>

    <div v-if="showCreate" class="bg-gray-50 rounded-lg p-3 mb-3 flex gap-2">
      <input
        v-model="manualLabel"
        placeholder="Метка версии (необязательно)"
        class="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        :disabled="busy"
        class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        @click="createManualSnapshot"
      >
        Сохранить
      </button>
    </div>

    <div v-if="error" class="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 mb-3">
      {{ error }}
    </div>

    <div v-if="loading" class="text-xs text-gray-400 py-3">Загрузка…</div>
    <div v-else-if="sortedSnapshots.length === 0" class="text-xs text-gray-400 py-3">
      Пока нет снимков.
    </div>
    <ul v-else class="space-y-2 max-h-72 overflow-y-auto">
      <li
        v-for="snap in sortedSnapshots"
        :key="snap.id"
        class="flex items-start justify-between gap-2 bg-gray-50 rounded-lg p-2.5"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="text-xs font-mono text-gray-600">v{{ snap.version }}</span>
            <span
              :class="kindBadge(snap.kind).cls"
              class="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider"
            >
              {{ kindBadge(snap.kind).label }}
            </span>
            <span class="text-xs text-gray-500">{{ stageLabel(snap.stage) }}</span>
          </div>
          <p class="text-xs text-gray-600 truncate">
            {{ snap.label || 'Без метки' }}
          </p>
          <p class="text-[11px] text-gray-400">{{ fmtDate(snap.created_at) }}</p>
        </div>
        <div class="shrink-0">
          <template v-if="confirmingVersion === snap.version">
            <button
              type="button"
              :disabled="busy"
              class="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
              @click="restore(snap.version)"
            >
              Подтвердить
            </button>
            <button
              type="button"
              class="text-xs ml-1 text-gray-500 hover:text-gray-700"
              @click="confirmingVersion = null"
            >
              отмена
            </button>
          </template>
          <button
            v-else
            type="button"
            class="text-xs text-blue-600 hover:text-blue-700"
            @click="confirmingVersion = snap.version"
          >
            Откатить
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
