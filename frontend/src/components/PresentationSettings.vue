<script setup>
const props = defineProps({
  slideCount: {
    type: Number,
    default: 0
  },
  modelValue: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:slideCount', 'update:modelValue'])

const fonts = [
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Inter',
  'Roboto'
]

function updateSettings(partial) {
  emit('update:modelValue', {
    ...props.modelValue,
    ...partial
  })
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-900">Настройки презентации</h2>
      <span class="text-xs text-gray-400">Опционально</span>
    </div>

    <div class="space-y-3">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Количество слайдов
        </label>
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="20"
            :value="slideCount"
            @input="emit('update:slideCount', Number($event.target.value))"
            class="w-full"
          />
          <input
            type="number"
            min="0"
            max="20"
            :value="slideCount"
            @input="emit('update:slideCount', Number($event.target.value))"
            class="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
          />
        </div>
        <p class="mt-1 text-[11px] text-gray-400">
          0 — доверить количество слайдов модели; больше — жёстко задать рамку.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Основной шрифт
          </label>
          <select
            :value="modelValue.fontFamily || 'Inter'"
            @change="updateSettings({ fontFamily: $event.target.value })"
            class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
          >
            <option v-for="font in fonts" :key="font" :value="font">
              {{ font }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Шрифт заголовков
          </label>
          <select
            :value="modelValue.titleFontFamily || modelValue.fontFamily || 'Inter'"
            @change="updateSettings({ titleFontFamily: $event.target.value })"
            class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white"
          >
            <option v-for="font in fonts" :key="font" :value="font">
              {{ font }}
            </option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 items-center">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Основной цвет
          </label>
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="modelValue.primaryColor || '#2563eb'"
              @input="updateSettings({ primaryColor: $event.target.value })"
              class="h-8 w-8 rounded border border-gray-200 cursor-pointer"
            />
            <input
              type="text"
              :value="modelValue.primaryColor || '#2563eb'"
              @input="updateSettings({ primaryColor: $event.target.value })"
              class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Цвет фона
          </label>
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="modelValue.backgroundColor || '#ffffff'"
              @input="updateSettings({ backgroundColor: $event.target.value })"
              class="h-8 w-8 rounded border border-gray-200 cursor-pointer"
            />
            <input
              type="text"
              :value="modelValue.backgroundColor || '#ffffff'"
              @input="updateSettings({ backgroundColor: $event.target.value })"
              class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
            />
          </div>
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Размер текста
        </label>
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="12"
            max="28"
            :value="modelValue.fontSize || 16"
            @input="updateSettings({ fontSize: Number($event.target.value) })"
            class="w-full"
          />
          <span class="w-10 text-right text-xs text-gray-600">
            {{ modelValue.fontSize || 16 }}pt
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

