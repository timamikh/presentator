<script setup>
// Drafts panel for the /create page.
//
// Lets the user:
//   • Save current form state as a named draft (POST /api/drafts).
//   • Load any saved draft into the form (GET /api/drafts/:id).
//   • Browse and restore version history of a draft.
//   • Delete a draft.
//
// The parent provides two callbacks via events:
//   • collect()  → returns the current form payload to save.
//   • applyDraft(draft) → loads draft fields back into form state.
//
// Backed by /api/drafts (api-service/src/routes/drafts.js).

import { ref, onMounted } from 'vue'
import client from '../api/client'
import { fmtTimestamp as fmtDate, kindBadge } from '../utils/formatters'

const props = defineProps({
  // Function passed by parent that returns the current form state object.
  // Parent calls this just-in-time to capture the latest values.
  collectPayload: { type: Function, required: true },
})

const emit = defineEmits(['apply'])

const drafts = ref([])
const versions = ref([])
const selectedDraftId = ref(null)
const draftName = ref('')
const showSaveForm = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')

async function fetchDrafts() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/drafts')
    drafts.value = Array.isArray(data) ? data : []
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось загрузить черновики'
  } finally {
    loading.value = false
  }
}

async function saveDraft() {
  const name = draftName.value.trim()
  if (!name) {
    error.value = 'Введите название черновика'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const payload = { name, ...props.collectPayload() }
    if (selectedDraftId.value) {
      await client.put(`/drafts/${selectedDraftId.value}`, payload)
    } else {
      const { data } = await client.post('/drafts', payload)
      selectedDraftId.value = data.id
    }
    showSaveForm.value = false
    draftName.value = ''
    await fetchDrafts()
    if (selectedDraftId.value) await fetchVersions(selectedDraftId.value)
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось сохранить'
  } finally {
    busy.value = false
  }
}

async function loadDraft(id) {
  busy.value = true
  error.value = ''
  try {
    const { data } = await client.get(`/drafts/${id}`)
    selectedDraftId.value = id
    draftName.value = data.name
    emit('apply', data)
    await fetchVersions(id)
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось открыть черновик'
  } finally {
    busy.value = false
  }
}

async function fetchVersions(id) {
  try {
    const { data } = await client.get(`/drafts/${id}/versions`)
    versions.value = Array.isArray(data) ? data : []
  } catch {
    versions.value = []
  }
}

async function restoreVersion(version) {
  if (!selectedDraftId.value) return
  busy.value = true
  error.value = ''
  try {
    await client.post(`/drafts/${selectedDraftId.value}/versions/${version}/restore`)
    await loadDraft(selectedDraftId.value)
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось откатить'
  } finally {
    busy.value = false
  }
}

async function deleteDraft(id) {
  if (!window.confirm('Удалить черновик целиком?')) return
  busy.value = true
  error.value = ''
  try {
    await client.delete(`/drafts/${id}`)
    if (selectedDraftId.value === id) {
      selectedDraftId.value = null
      versions.value = []
      draftName.value = ''
    }
    await fetchDrafts()
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось удалить'
  } finally {
    busy.value = false
  }
}

function newDraft() {
  selectedDraftId.value = null
  versions.value = []
  draftName.value = ''
  showSaveForm.value = true
}

onMounted(fetchDrafts)
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-700">Черновики</h3>
        <p class="text-xs text-gray-400">
          Сохраняйте версии формы — можно вернуться к любому состоянию до запуска пайплайна.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="text-xs text-gray-500 hover:text-gray-700"
          @click="newDraft"
        >
          + Новый
        </button>
        <button
          type="button"
          class="text-xs text-blue-600 hover:text-blue-700 font-medium"
          @click="showSaveForm = !showSaveForm"
        >
          {{ selectedDraftId ? 'Сохранить версию' : 'Сохранить' }}
        </button>
      </div>
    </div>

    <div v-if="showSaveForm" class="bg-gray-50 rounded-lg p-3 mb-3 flex gap-2">
      <input
        v-model="draftName"
        placeholder="Название черновика"
        class="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        :disabled="busy"
        class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        @click="saveDraft"
      >
        {{ selectedDraftId ? 'Сохранить' : 'Создать' }}
      </button>
    </div>

    <div v-if="error" class="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 mb-3">
      {{ error }}
    </div>

    <div v-if="loading" class="text-xs text-gray-400 py-3">Загрузка…</div>
    <template v-else>
      <div v-if="drafts.length === 0" class="text-xs text-gray-400 py-3">
        Нет сохранённых черновиков.
      </div>
      <ul v-else class="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
        <li
          v-for="d in drafts"
          :key="d.id"
          class="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs cursor-pointer"
          :class="selectedDraftId === d.id ? 'bg-blue-50' : 'bg-gray-50 hover:bg-gray-100'"
          @click="loadDraft(d.id)"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium text-gray-700 truncate">{{ d.name }}</p>
            <p class="text-[11px] text-gray-400">
              v{{ d.head_version }} · обновлён {{ fmtDate(d.updated_at) }}
            </p>
          </div>
          <button
            type="button"
            class="text-gray-400 hover:text-red-500 shrink-0"
            @click.stop="deleteDraft(d.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </li>
      </ul>

      <div v-if="selectedDraftId && versions.length > 0">
        <p class="text-xs font-medium text-gray-600 mb-1.5">Версии:</p>
        <ul class="space-y-1 max-h-40 overflow-y-auto">
          <li
            v-for="v in versions"
            :key="v.id"
            class="flex items-center justify-between gap-2 px-2 py-1 text-xs"
          >
            <span class="flex items-center gap-2 min-w-0">
              <span class="font-mono text-gray-500">v{{ v.version }}</span>
              <span
                :class="kindBadge(v.kind).cls"
                class="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider"
              >
                {{ kindBadge(v.kind).label }}
              </span>
              <span class="text-[11px] text-gray-400">{{ fmtDate(v.created_at) }}</span>
            </span>
            <button
              type="button"
              :disabled="busy"
              class="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
              @click="restoreVersion(v.version)"
            >
              откатить
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
