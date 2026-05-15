<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import client from '../api/client'
import DesignBriefForm from '../components/design/DesignBriefForm.vue'
import SlidePromptsEditor from '../components/SlidePromptsEditor.vue'
import PromptsSettingsModal from '../components/PromptsSettingsModal.vue'
import StoragePicker from '../components/storage/StoragePicker.vue'
import DraftsPanel from '../components/DraftsPanel.vue'
import { usePromptAggregator } from '../composables/usePromptAggregator'
import {
  defaultDesignBrief,
  aggregateDesignBrief,
} from '../composables/useDesignBriefAggregator'
import {
  extractDraftAttachmentIds,
  mergeDraftAttachments,
} from '../composables/useDraftAttachments'

const router = useRouter()
const prompt = ref('')
const files = ref([])
const error = ref('')
const submitting = ref(false)
const dragging = ref(false)
const slideCount = ref(0)
const designBriefForm = ref(defaultDesignBrief())
const slidePrompts = ref([])
const systemPrompt = ref('')
const showSystemPromptModal = ref(false)

// libraryAttachments: rows from the picker, augmented with editable per-job description
// (snapshot semantics — backend copies this into job_attachments and never writes back).
const libraryAttachments = ref([])
const showStoragePicker = ref(false)

// Legacy presentation_settings shape kept for back-compat with pipeline_version=1.
// For v2 the design brief is the source of truth and overwrites this on submit.
const presentationSettings = computed(() => ({
  fontFamily: designBriefForm.value?.typography?.body || 'Inter',
  titleFontFamily: designBriefForm.value?.typography?.heading || 'Inter',
  primaryColor: designBriefForm.value?.palette?.primary || '#2563eb',
  backgroundColor: designBriefForm.value?.palette?.bg || '#ffffff',
  fontSize: 16,
}))

const aggregatedDesignBrief = computed(() => aggregateDesignBrief(designBriefForm.value))

const { toFormData } = usePromptAggregator({
  prompt,
  slideCount,
  slidePrompts,
  presentationSettings,
  systemPrompt,
  attachments: libraryAttachments,
  designBrief: aggregatedDesignBrief,
})

const MAX_FILES = 10

function handleFileSelect(event) {
  addFiles(event.target.files)
  event.target.value = ''
}

function handleDrop(event) {
  dragging.value = false
  addFiles(event.dataTransfer.files)
}

function addFiles(fileList) {
  const incoming = Array.from(fileList)
  const available = MAX_FILES - files.value.length
  if (available <= 0) return
  files.value.push(...incoming.slice(0, available))
}

function removeFile(index) {
  files.value.splice(index, 1)
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ'
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
}

function handleStorageConfirm(selected) {
  // Merge: keep existing entries, add only new ones (do not overwrite local description edits).
  const existingIds = new Set(libraryAttachments.value.map((a) => a.id))
  for (const att of selected) {
    if (!existingIds.has(att.id)) {
      libraryAttachments.value.push({
        ...att,
        // snapshot the library description into a job-local description field
        description: att.description || ''
      })
    }
  }
}

function removeLibraryAttachment(id) {
  libraryAttachments.value = libraryAttachments.value.filter((a) => a.id !== id)
}

function getAttachmentPreviewUrl(id) {
  const token = localStorage.getItem('token') || ''
  return `/api/files/attachment/${id}?token=${encodeURIComponent(token)}`
}

function kindLabel(kind) {
  return { image: 'изображение', document: 'документ', other: 'файл' }[kind] || 'файл'
}

// ── Drafts integration ─────────────────────────────────────────────
//
// DraftsPanel needs two callbacks:
//   • collectPayload() — capture current form state for save/PUT
//   • on @apply — load draft fields back into form state
//
// We do NOT round-trip files (one-shot uploads): they live only in browser
// memory until submit. Library attachments are fully restorable.
function collectDraftPayload() {
  return {
    prompt: prompt.value,
    slide_count: slideCount.value,
    slide_prompts: slidePrompts.value,
    presentation_settings: presentationSettings.value,
    system_prompt: systemPrompt.value || null,
    design_input: designBriefForm.value,
    design_brief: aggregatedDesignBrief.value,
    attachments: libraryAttachments.value.map((a) => ({
      attachmentId: a.id,
      description: a.description,
    })),
    pipeline_version: 2,
  }
}

async function applyDraft(draft) {
  prompt.value = draft.prompt || ''
  slideCount.value = Number(draft.slide_count) || 0
  slidePrompts.value = Array.isArray(draft.slide_prompts) ? draft.slide_prompts : []
  systemPrompt.value = draft.system_prompt || ''
  if (draft.design_input && typeof draft.design_input === 'object') {
    designBriefForm.value = { ...defaultDesignBrief(), ...draft.design_input }
  }
  // Library attachments: drafts only persist { attachmentId, description }.
  // Re-hydrate the full rows via the batch endpoint so the picker preview,
  // ref labels and per-job descriptions all come back correctly. Attachments
  // that have been deleted from the library since the draft was saved are
  // silently dropped (mergeDraftAttachments handles this).
  const ids = extractDraftAttachmentIds(draft.attachments)
  if (ids.length === 0) {
    libraryAttachments.value = []
    return
  }
  try {
    const { data } = await client.get('/attachments/by-ids', {
      params: { ids: ids.join(',') },
    })
    libraryAttachments.value = mergeDraftAttachments(data, draft.attachments)
  } catch (err) {
    console.warn('Failed to restore draft attachments:', err.message)
    libraryAttachments.value = []
  }
}

async function handleSubmit() {
  if (!prompt.value.trim()) return
  error.value = ''
  submitting.value = true

  try {
    const formData = toFormData(files.value)
    const { data } = await client.post('/jobs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    router.push(`/jobs/${data.id}`)
  } catch (err) {
    error.value = err.response?.data?.error || err.response?.data?.detail || 'Не удалось создать задачу'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <router-link to="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Назад
    </router-link>

    <h1 class="text-2xl font-bold text-gray-900 mb-6">Новая презентация</h1>

    <DraftsPanel
      class="mb-6"
      :collect-payload="collectDraftPayload"
      @apply="applyDraft"
    />

    <form @submit.prevent="handleSubmit" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)] gap-6">
        <div class="space-y-4">
          <DesignBriefForm
            :slide-count="slideCount"
            :model-value="designBriefForm"
            @update:slide-count="slideCount = $event"
            @update:model-value="designBriefForm = $event"
          />

          <SlidePromptsEditor
            :slide-count="slideCount"
            :model-value="slidePrompts"
            @update:model-value="slidePrompts = $event"
          />
        </div>

        <div class="space-y-4">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label for="prompt" class="block text-sm font-medium text-gray-700">
                Описание
              </label>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                @click="showSystemPromptModal = true"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Системные промты</span>
              </button>
            </div>
            <textarea
              id="prompt"
              v-model="prompt"
              rows="6"
              required
              placeholder="Опишите, какую презентацию вы хотите создать..."
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
            ></textarea>
          </div>

          <!-- Library attachments -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="block text-sm font-medium text-gray-700">
                Вложения из хранилища
              </label>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                @click="showStoragePicker = true"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                Выбрать из хранилища
              </button>
            </div>

            <ul v-if="libraryAttachments.length" class="space-y-2">
              <li
                v-for="att in libraryAttachments"
                :key="att.id"
                class="bg-gray-50 rounded-lg p-2.5 flex gap-3"
              >
                <div class="w-14 h-14 bg-white rounded border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                  <img
                    v-if="att.kind === 'image'"
                    :src="getAttachmentPreviewUrl(att.id)"
                    :alt="att.original_name"
                    class="max-h-full max-w-full object-contain"
                    loading="lazy"
                  />
                  <svg v-else class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-gray-800 truncate">{{ att.original_name }}</p>
                      <p class="text-[11px] text-gray-400">
                        {{ kindLabel(att.kind) }}<span v-if="att.ref"> · ref={{ att.ref }}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      class="text-gray-400 hover:text-red-500 shrink-0"
                      @click="removeLibraryAttachment(att.id)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <textarea
                    v-model="att.description"
                    rows="2"
                    placeholder="Описание для LLM (что это и как использовать)..."
                    class="mt-1.5 w-full px-2 py-1 text-xs border border-gray-200 rounded resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
                  ></textarea>
                </div>
              </li>
            </ul>
            <p v-else class="text-xs text-gray-400">
              Нажмите «Выбрать из хранилища», чтобы добавить ранее загруженные файлы. У каждого вложения можно отредактировать описание для текущей задачи — оригинал в библиотеке не изменится.
            </p>
          </div>

          <!-- One-shot file uploads (legacy path) -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Разовые файлы <span class="text-gray-400 font-normal">(до {{ MAX_FILES }})</span>
            </label>

            <div
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="handleDrop"
              @click="$refs.fileInput.click()"
              :class="[
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              ]"
            >
              <input
                ref="fileInput"
                type="file"
                multiple
                class="hidden"
                @change="handleFileSelect"
              />
              <svg class="w-8 h-8 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p class="text-sm text-gray-500">
                Перетащите файлы сюда или <span class="text-blue-600 font-medium">выберите</span>
              </p>
            </div>

            <ul v-if="files.length" class="mt-3 space-y-2">
              <li
                v-for="(file, idx) in files"
                :key="idx"
                class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span class="truncate">{{ file.name }}</span>
                  <span class="text-gray-400 shrink-0">{{ formatSize(file.size) }}</span>
                </div>
                <button type="button" @click.stop="removeFile(idx)" class="text-gray-400 hover:text-red-500 ml-2">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div v-if="error" class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
        {{ error }}
      </div>

      <button
        type="submit"
        :disabled="submitting || !prompt.trim()"
        class="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span v-if="submitting">Создаём...</span>
        <span v-else>Создать</span>
      </button>
    </form>

    <PromptsSettingsModal
      v-model="showSystemPromptModal"
      :current-prompt="systemPrompt"
      @update:system-prompt="systemPrompt = $event"
    />

    <StoragePicker
      v-model="showStoragePicker"
      :initially-selected-ids="libraryAttachments.map((a) => a.id)"
      @confirm="handleStorageConfirm"
    />
  </div>
</template>
