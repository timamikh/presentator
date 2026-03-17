<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import client from '../api/client'
import PresentationSettings from '../components/PresentationSettings.vue'
import SlidePromptsEditor from '../components/SlidePromptsEditor.vue'
import SystemPromptModal from '../components/SystemPromptModal.vue'
import StoragePicker from '../components/StoragePicker.vue'
import { usePromptAggregator } from '../composables/usePromptAggregator'

const router = useRouter()
const prompt = ref('')
const uploadItems = ref([]) // [{ file: File, prompt: string }]
const libraryItems = ref([]) // [{ attachment: object, prompt: string }]
const error = ref('')
const submitting = ref(false)
const dragging = ref(false)
const slideCount = ref(0)
const presentationSettings = ref({
  fontFamily: 'Inter',
  titleFontFamily: 'Inter',
  primaryColor: '#2563eb',
  backgroundColor: '#ffffff',
  fontSize: 16
})
const slidePrompts = ref([])
const systemPrompt = ref('')
const showSystemPromptModal = ref(false)
const showStoragePicker = ref(false)

const { toFormData } = usePromptAggregator({
  prompt,
  slideCount,
  slidePrompts,
  presentationSettings,
  systemPrompt
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
  const available = MAX_FILES - (uploadItems.value.length + libraryItems.value.length)
  if (available <= 0) return
  uploadItems.value.push(
    ...incoming.slice(0, available).map((f) => ({ file: f, prompt: '' }))
  )
}

function removeUpload(index) {
  uploadItems.value.splice(index, 1)
}

function removeLibrary(index) {
  libraryItems.value.splice(index, 1)
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ'
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
}

function openStoragePicker() {
  showStoragePicker.value = true
}

function onStorageConfirm(selected) {
  const existing = new Set(libraryItems.value.map((x) => x.attachment.id))
  const available = MAX_FILES - (uploadItems.value.length + libraryItems.value.length)
  if (available <= 0) return

  const toAdd = (Array.isArray(selected) ? selected : [])
    .filter((a) => a && a.id && !existing.has(a.id))
    .slice(0, available)
    .map((a) => ({ attachment: a, prompt: a.prompt || '' }))
  libraryItems.value.push(...toAdd)
}

async function handleSubmit() {
  if (!prompt.value.trim()) return
  error.value = ''
  submitting.value = true

  try {
    const files = uploadItems.value.map((x) => x.file)
    const attachmentIds = libraryItems.value.map((x) => x.attachment.id)
    const filePrompts = [
      ...uploadItems.value.map((x) => ({ fileName: x.file.name, prompt: x.prompt || '' })),
      ...libraryItems.value.map((x) => ({ attachmentId: x.attachment.id, prompt: x.prompt || '' }))
    ]

    const formData = toFormData({ files, attachmentIds, filePrompts })
    const { data } = await client.post('/jobs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    router.push(`/jobs/${data.id}`)
  } catch (err) {
    error.value = err.response?.data?.error || 'Не удалось создать задачу'
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

    <form @submit.prevent="handleSubmit" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)] gap-6">
        <div class="space-y-4">
          <PresentationSettings
            :slide-count="slideCount"
            :model-value="presentationSettings"
            @update:slide-count="slideCount = $event"
            @update:model-value="presentationSettings = $event"
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
                <span>Системный промт</span>
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

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Файлы <span class="text-gray-400 font-normal">(до {{ MAX_FILES }})</span>
            </label>

            <div class="flex items-center justify-between gap-3 mb-2">
              <p class="text-xs text-gray-500">
                Всего выбрано: {{ uploadItems.length + libraryItems.length }} / {{ MAX_FILES }}
              </p>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                @click="openStoragePicker"
              >
                Добавить из хранилища
              </button>
            </div>

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

            <ul v-if="libraryItems.length" class="mt-3 space-y-2">
              <li
                v-for="(item, idx) in libraryItems"
                :key="item.attachment.id"
                class="bg-gray-50 rounded-lg px-3 py-2 text-sm"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-center gap-2 min-w-0">
                    <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div class="min-w-0">
                      <p class="truncate">
                        {{ item.attachment.original_name }}
                        <span class="ml-1 text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">хранилище</span>
                      </p>
                      <p class="text-xs text-gray-400 truncate">{{ item.attachment.prompt || 'Без промта' }}</p>
                    </div>
                  </div>
                  <button type="button" @click="removeLibrary(idx)" class="text-gray-400 hover:text-red-500 ml-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <textarea
                  v-model="item.prompt"
                  rows="2"
                  class="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
                  placeholder="Промт: как использовать этот файл"
                ></textarea>
              </li>
            </ul>

            <ul v-if="uploadItems.length" class="mt-3 space-y-2">
              <li
                v-for="(item, idx) in uploadItems"
                :key="idx"
                class="bg-gray-50 rounded-lg px-3 py-2 text-sm"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-center gap-2 min-w-0">
                    <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div class="min-w-0">
                      <p class="truncate">{{ item.file.name }}</p>
                      <p class="text-xs text-gray-400">{{ formatSize(item.file.size) }}</p>
                    </div>
                  </div>
                  <button type="button" @click.stop="removeUpload(idx)" class="text-gray-400 hover:text-red-500 ml-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <textarea
                  v-model="item.prompt"
                  rows="2"
                  class="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
                  placeholder="Промт: как использовать этот файл"
                ></textarea>
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

    <SystemPromptModal
      v-model="showSystemPromptModal"
      :current-prompt="systemPrompt"
      @update:system-prompt="systemPrompt = $event"
    />

    <StoragePicker
      v-model="showStoragePicker"
      :selected-ids="libraryItems.map((x) => x.attachment.id)"
      @confirm="onStorageConfirm"
    />
  </div>
</template>
