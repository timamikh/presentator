<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import client from '../api/client'

const router = useRouter()
const prompt = ref('')
const files = ref([])
const error = ref('')
const submitting = ref(false)
const dragging = ref(false)

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

async function handleSubmit() {
  if (!prompt.value.trim()) return
  error.value = ''
  submitting.value = true

  try {
    const formData = new FormData()
    formData.append('prompt', prompt.value.trim())
    files.value.forEach((file) => formData.append('files', file))

    const { data } = await client.post('/jobs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    router.push(`/jobs/${data.id}`)
  } catch (err) {
    error.value = err.response?.data?.detail || 'Не удалось создать задачу'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-8">
    <router-link to="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Назад
    </router-link>

    <h1 class="text-2xl font-bold text-gray-900 mb-6">Новая презентация</h1>

    <form @submit.prevent="handleSubmit" class="space-y-6">
      <div>
        <label for="prompt" class="block text-sm font-medium text-gray-700 mb-1">
          Описание
        </label>
        <textarea
          id="prompt"
          v-model="prompt"
          rows="5"
          required
          placeholder="Опишите, какую презентацию вы хотите создать..."
          class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
        ></textarea>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Файлы <span class="text-gray-400 font-normal">(до {{ MAX_FILES }})</span>
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
  </div>
</template>
