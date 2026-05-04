<script setup>
import { ref, watch, computed } from 'vue'
import FolderTree from './FolderTree.vue'
import AttachmentGrid from './AttachmentGrid.vue'
import { useStorage } from '../../composables/useStorage'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initiallySelectedIds: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const storage = useStorage()
const selectedIds = ref([...props.initiallySelectedIds])

const currentLabel = computed(() => {
  if (storage.currentFolderId.value === 'all') return 'Вся библиотека'
  if (!storage.currentFolderId.value) return 'Корневая папка'
  return storage.folderById.value.get(storage.currentFolderId.value)?.name || 'Папка'
})

const selectedAttachments = computed(() => {
  const ids = new Set(selectedIds.value)
  return storage.attachments.value.filter((a) => ids.has(a.id))
})

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      selectedIds.value = [...props.initiallySelectedIds]
      await storage.refresh()
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function toggleSelect(att) {
  const idx = selectedIds.value.indexOf(att.id)
  if (idx === -1) selectedIds.value.push(att.id)
  else selectedIds.value.splice(idx, 1)
}

async function confirmSelection() {
  // Hydrate the full attachment objects across all folders by fetching whichever
  // are not in the current folder list. We use `folderId=all` to grab everything
  // matching their ids client-side. Simpler: just snapshot what we have plus
  // request specific items not yet loaded.
  const have = new Map(storage.attachments.value.map((a) => [a.id, a]))
  const missing = selectedIds.value.filter((id) => !have.has(id))
  let resolved = selectedIds.value.map((id) => have.get(id)).filter(Boolean)

  if (missing.length > 0) {
    // Fall back to a global query (folderId=all) and pick missing ones.
    try {
      const prevFolder = storage.currentFolderId.value
      storage.currentFolderId.value = 'all'
      await storage.loadAttachments()
      const all = new Map(storage.attachments.value.map((a) => [a.id, a]))
      resolved = selectedIds.value.map((id) => have.get(id) || all.get(id)).filter(Boolean)
      storage.currentFolderId.value = prevFolder
    } catch {
      // best-effort; leave resolved as-is
    }
  }

  emit('confirm', resolved)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      @click.self="close"
    >
      <div class="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 class="text-base font-semibold text-gray-900">Выбор вложений из хранилища</h2>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-700"
            @click="close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="grid grid-cols-[220px_1fr] gap-0 flex-1 min-h-0">
          <aside class="border-r border-gray-200 p-3 overflow-y-auto">
            <button
              type="button"
              class="w-full text-left text-sm rounded px-2 py-1.5 mb-0.5"
              :class="storage.currentFolderId.value === null ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'"
              @click="storage.selectFolder(null)"
            >
              Корневая папка
            </button>
            <button
              type="button"
              class="w-full text-left text-sm rounded px-2 py-1.5 mb-2"
              :class="storage.currentFolderId.value === 'all' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'"
              @click="storage.selectFolder('all')"
            >
              Вся библиотека
            </button>
            <FolderTree
              :nodes="storage.folderTree.value"
              :current-folder-id="storage.currentFolderId.value"
              :show-actions="false"
              @select="(id) => storage.selectFolder(id)"
            />
          </aside>

          <section class="p-4 overflow-y-auto">
            <div class="flex items-center justify-between mb-3 gap-2">
              <h3 class="text-sm font-semibold text-gray-900">{{ currentLabel }}</h3>
              <input
                v-model="storage.searchQuery.value"
                type="search"
                placeholder="Поиск..."
                class="px-2 py-1 text-xs border border-gray-300 rounded w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
                @keydown.enter="storage.loadAttachments()"
              />
            </div>

            <p v-if="storage.error.value" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-3">
              {{ storage.error.value }}
            </p>

            <AttachmentGrid
              :attachments="storage.attachments.value"
              :selectable="true"
              :selected-ids="selectedIds"
              :preview-url-builder="storage.attachmentPreviewUrl"
              :show-actions="false"
              @toggle-select="toggleSelect"
            />
          </section>
        </div>

        <footer class="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
          <p class="text-sm text-gray-500">
            Выбрано: {{ selectedIds.length }}
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              @click="close"
            >
              Отмена
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              :disabled="selectedIds.length === 0"
              @click="confirmSelection"
            >
              Добавить ({{ selectedIds.length }})
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
