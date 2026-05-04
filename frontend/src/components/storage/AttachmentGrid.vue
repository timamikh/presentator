<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  attachments: { type: Array, required: true },
  selectable: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] },
  previewUrlBuilder: { type: Function, required: true },
  showActions: { type: Boolean, default: true },
})

const emit = defineEmits([
  'edit-description',
  'delete',
  'toggle-select',
])

const editingId = ref(null)
const editingValue = ref('')

const selectedSet = computed(() => new Set(props.selectedIds))

function startEdit(att) {
  editingId.value = att.id
  editingValue.value = att.description || ''
}

function cancelEdit() {
  editingId.value = null
  editingValue.value = ''
}

function commitEdit(att) {
  const next = editingValue.value
  cancelEdit()
  if (next !== (att.description || '')) {
    emit('edit-description', { id: att.id, description: next })
  }
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ'
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
}

function isImage(att) {
  return att.kind === 'image'
}

function kindLabel(kind) {
  return { image: 'изображение', document: 'документ', other: 'файл' }[kind] || 'файл'
}
</script>

<template>
  <div v-if="attachments.length === 0" class="text-center text-sm text-gray-400 py-12">
    В этой папке пока нет вложений
  </div>
  <div
    v-else
    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
  >
    <div
      v-for="att in attachments"
      :key="att.id"
      :class="[
        'bg-white border rounded-lg overflow-hidden flex flex-col transition',
        selectable && selectedSet.has(att.id)
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-gray-200',
      ]"
    >
      <div
        :class="[
          'relative bg-gray-50 h-32 flex items-center justify-center',
          selectable ? 'cursor-pointer' : '',
        ]"
        @click="selectable && emit('toggle-select', att)"
      >
        <img
          v-if="isImage(att)"
          :src="previewUrlBuilder(att.id)"
          :alt="att.original_name"
          class="max-h-full max-w-full object-contain"
          loading="lazy"
        />
        <div v-else class="flex flex-col items-center text-gray-400">
          <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span class="text-[10px] uppercase mt-1">{{ kindLabel(att.kind) }}</span>
        </div>

        <span
          v-if="selectable"
          :class="[
            'absolute top-2 right-2 w-5 h-5 rounded border flex items-center justify-center text-white',
            selectedSet.has(att.id) ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300',
          ]"
        >
          <svg v-if="selectedSet.has(att.id)" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      </div>

      <div class="p-3 flex flex-col gap-2 flex-1">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-800 truncate" :title="att.original_name">
              {{ att.original_name }}
            </p>
            <p class="text-[11px] text-gray-400">
              {{ kindLabel(att.kind) }}<span v-if="att.file_size"> · {{ formatSize(att.file_size) }}</span>
            </p>
          </div>
          <button
            v-if="showActions"
            type="button"
            class="text-gray-400 hover:text-red-600 shrink-0"
            title="Удалить"
            @click="emit('delete', att)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </button>
        </div>

        <div>
          <textarea
            v-if="editingId === att.id"
            v-model="editingValue"
            rows="3"
            class="w-full text-xs border border-blue-300 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Что это и как использовать..."
            @blur="commitEdit(att)"
            @keydown.esc.prevent="cancelEdit"
            @keydown.meta.enter.prevent="commitEdit(att)"
            @keydown.ctrl.enter.prevent="commitEdit(att)"
          />
          <p
            v-else
            class="text-xs text-gray-600 whitespace-pre-wrap break-words cursor-text min-h-[2.25rem] hover:bg-gray-50 rounded p-1.5"
            :title="att.description || 'Кликните, чтобы добавить описание'"
            @click="startEdit(att)"
          >
            <span v-if="att.description">{{ att.description }}</span>
            <span v-else class="text-gray-400 italic">Кликните, чтобы добавить описание</span>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
