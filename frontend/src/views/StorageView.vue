<script setup>
import { onMounted, ref, computed } from 'vue'
import FolderTree from '../components/storage/FolderTree.vue'
import AttachmentGrid from '../components/storage/AttachmentGrid.vue'
import { useStorage } from '../composables/useStorage'

const storage = useStorage()
const fileInput = ref(null)
const dragging = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const newFolderName = ref('')
const showNewFolderInput = ref(false)
const newFolderParent = ref(null)

const currentLabel = computed(() => {
  if (storage.currentFolderId.value === 'all') return 'Вся библиотека'
  if (!storage.currentFolderId.value) return 'Корневая папка'
  return storage.folderById.value.get(storage.currentFolderId.value)?.name || 'Папка'
})

onMounted(() => storage.refresh())

async function handleSelectFolder(id) {
  await storage.selectFolder(id)
}

async function handleSelectRoot() {
  await storage.selectFolder(null)
}

async function handleSelectAll() {
  await storage.selectFolder('all')
}

function openCreateFolderAtRoot() {
  showNewFolderInput.value = true
  newFolderParent.value = storage.currentFolderId.value === 'all' ? null : storage.currentFolderId.value
  newFolderName.value = ''
}

function openCreateChild(parentId) {
  showNewFolderInput.value = true
  newFolderParent.value = parentId
  newFolderName.value = ''
}

async function submitCreateFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  try {
    const folder = await storage.createFolder(name, newFolderParent.value || null)
    showNewFolderInput.value = false
    newFolderName.value = ''
    await storage.selectFolder(folder.id)
  } catch (e) {
    storage.error.value = e.response?.data?.error || 'Не удалось создать папку'
  }
}

async function handleRenameFolder(folder) {
  const next = window.prompt('Новое имя папки:', folder.name)
  if (!next || next.trim() === folder.name) return
  try {
    await storage.renameFolder(folder.id, next.trim())
  } catch (e) {
    storage.error.value = e.response?.data?.error || 'Не удалось переименовать'
  }
}

async function handleDeleteFolder(folder) {
  if (!window.confirm(`Удалить папку «${folder.name}»?`)) return
  try {
    await storage.deleteFolder(folder.id, false)
  } catch (e) {
    if (e.response?.status === 409) {
      const data = e.response.data
      if (
        window.confirm(
          `Папка не пуста (${data.subfolders} подпапок, ${data.attachments} вложений).\nУдалить вместе с подпапками? Вложения будут перемещены в корень.`,
        )
      ) {
        try {
          await storage.deleteFolder(folder.id, true)
        } catch (err) {
          storage.error.value = err.response?.data?.error || 'Не удалось удалить'
        }
      }
    } else {
      storage.error.value = e.response?.data?.error || 'Не удалось удалить'
    }
  }
}

function pickFiles() {
  fileInput.value?.click()
}

function onFilesSelected(event) {
  const list = event.target.files
  if (list && list.length) uploadFiles(list)
  event.target.value = ''
}

function onFilesDropped(event) {
  dragging.value = false
  const list = event.dataTransfer?.files
  if (list && list.length) uploadFiles(list)
}

async function uploadFiles(fileList) {
  uploadError.value = ''
  uploading.value = true
  try {
    const folderId =
      storage.currentFolderId.value && storage.currentFolderId.value !== 'all'
        ? storage.currentFolderId.value
        : null
    for (const file of Array.from(fileList)) {
      await storage.uploadAttachment(file, { folderId })
    }
  } catch (e) {
    uploadError.value = e.response?.data?.error || 'Ошибка загрузки'
  } finally {
    uploading.value = false
  }
}

async function handleEditDescription({ id, description }) {
  try {
    await storage.updateAttachment(id, { description })
  } catch (e) {
    storage.error.value = e.response?.data?.error || 'Не удалось сохранить описание'
  }
}

async function handleDeleteAttachment(att) {
  if (!window.confirm(`Удалить «${att.original_name}»?`)) return
  try {
    await storage.deleteAttachment(att.id, false)
  } catch (e) {
    if (e.response?.status === 409) {
      const used = e.response.data.usedInJobs
      if (
        window.confirm(
          `Вложение используется в ${used} презентациях. Всё равно удалить (будет удалено из всех задач)?`,
        )
      ) {
        try {
          await storage.deleteAttachment(att.id, true)
        } catch (err) {
          storage.error.value = err.response?.data?.error || 'Не удалось удалить'
        }
      }
    } else {
      storage.error.value = e.response?.data?.error || 'Не удалось удалить'
    }
  }
}
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <router-link to="/" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Назад
        </router-link>
        <h1 class="text-2xl font-bold text-gray-900">Хранилище</h1>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      <!-- Sidebar: tree -->
      <aside class="bg-white border border-gray-200 rounded-xl p-3">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Папки</h2>
          <button
            type="button"
            class="p-1 text-gray-400 hover:text-blue-600"
            title="Создать папку"
            @click="openCreateFolderAtRoot"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          class="w-full text-left text-sm rounded px-2 py-1.5 mb-0.5"
          :class="storage.currentFolderId.value === null ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'"
          @click="handleSelectRoot"
        >
          Корневая папка
        </button>
        <button
          type="button"
          class="w-full text-left text-sm rounded px-2 py-1.5 mb-2"
          :class="storage.currentFolderId.value === 'all' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'"
          @click="handleSelectAll"
        >
          Вся библиотека
        </button>

        <FolderTree
          :nodes="storage.folderTree.value"
          :current-folder-id="storage.currentFolderId.value"
          @select="handleSelectFolder"
          @create-child="openCreateChild"
          @rename="handleRenameFolder"
          @delete="handleDeleteFolder"
        />

        <div v-if="showNewFolderInput" class="mt-3 border-t pt-3">
          <input
            v-model="newFolderName"
            type="text"
            placeholder="Имя новой папки"
            class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            @keydown.enter.prevent="submitCreateFolder"
            @keydown.esc.prevent="showNewFolderInput = false"
          />
          <div class="flex gap-2 mt-2">
            <button
              type="button"
              class="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              @click="submitCreateFolder"
            >
              Создать
            </button>
            <button
              type="button"
              class="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
              @click="showNewFolderInput = false"
            >
              Отмена
            </button>
          </div>
          <p class="text-[11px] text-gray-400 mt-1">
            <span v-if="newFolderParent">Внутри выбранной папки</span>
            <span v-else>В корне</span>
          </p>
        </div>
      </aside>

      <!-- Main: search + grid + drop area -->
      <section>
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <h2 class="text-lg font-semibold text-gray-900 mr-auto">{{ currentLabel }}</h2>

          <input
            v-model="storage.searchQuery.value"
            type="search"
            placeholder="Поиск..."
            class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
            @keydown.enter="storage.loadAttachments()"
          />

          <select
            v-model="storage.kindFilter.value"
            class="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
            @change="storage.loadAttachments()"
          >
            <option value="">Любой тип</option>
            <option value="image">Изображения</option>
            <option value="document">Документы</option>
            <option value="other">Прочее</option>
          </select>

          <button
            type="button"
            class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            @click="pickFiles"
            :disabled="uploading"
          >
            <span v-if="uploading">Загрузка...</span>
            <span v-else>Загрузить</span>
          </button>
          <input
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onFilesSelected"
          />
        </div>

        <p v-if="uploadError" class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
          {{ uploadError }}
        </p>
        <p v-if="storage.error.value" class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
          {{ storage.error.value }}
        </p>

        <div
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onFilesDropped"
          :class="[
            'rounded-xl border-2 border-dashed transition p-3',
            dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white',
          ]"
        >
          <p class="text-xs text-gray-400 mb-3 text-center">
            Перетащите файлы сюда или нажмите «Загрузить»
          </p>

          <AttachmentGrid
            :attachments="storage.attachments.value"
            :preview-url-builder="storage.attachmentPreviewUrl"
            :show-actions="true"
            @edit-description="handleEditDescription"
            @delete="handleDeleteAttachment"
          />
        </div>
      </section>
    </div>
  </div>
</template>
