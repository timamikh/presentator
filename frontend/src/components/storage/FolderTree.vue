<script setup>
import { ref } from 'vue'

const props = defineProps({
  nodes: { type: Array, required: true },
  currentFolderId: { type: [String, null], default: null },
  level: { type: Number, default: 0 },
  showActions: { type: Boolean, default: true },
})

const emit = defineEmits([
  'select',
  'create-child',
  'rename',
  'delete',
])

const expanded = ref(new Set())

function toggle(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function isExpanded(id) {
  return expanded.value.has(id)
}
</script>

<template>
  <ul class="space-y-0.5" :class="{ 'pl-4': level > 0 }">
    <li v-for="node in nodes" :key="node.id">
      <div
        class="group flex items-center gap-1 rounded px-1.5 py-1 text-sm cursor-pointer"
        :class="currentFolderId === node.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'"
        @click="emit('select', node.id)"
      >
        <button
          v-if="node.children && node.children.length"
          type="button"
          @click.stop="toggle(node.id)"
          class="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700"
          :aria-label="isExpanded(node.id) ? 'Свернуть' : 'Развернуть'"
        >
          <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-90': isExpanded(node.id) }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <span v-else class="w-4 h-4" />

        <svg class="w-4 h-4 text-gray-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>

        <span class="truncate flex-1">{{ node.name }}</span>

        <div v-if="showActions" class="hidden group-hover:flex gap-0.5 shrink-0">
          <button
            type="button"
            class="p-1 text-gray-400 hover:text-blue-600"
            title="Создать подпапку"
            @click.stop="emit('create-child', node.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            type="button"
            class="p-1 text-gray-400 hover:text-blue-600"
            title="Переименовать"
            @click.stop="emit('rename', node)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            type="button"
            class="p-1 text-gray-400 hover:text-red-600"
            title="Удалить"
            @click.stop="emit('delete', node)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </button>
        </div>
      </div>

      <FolderTree
        v-if="node.children && node.children.length && isExpanded(node.id)"
        :nodes="node.children"
        :current-folder-id="currentFolderId"
        :level="level + 1"
        :show-actions="showActions"
        @select="(id) => emit('select', id)"
        @create-child="(id) => emit('create-child', id)"
        @rename="(n) => emit('rename', n)"
        @delete="(n) => emit('delete', n)"
      />
    </li>
  </ul>
</template>
