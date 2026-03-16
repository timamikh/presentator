<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  slideData: {
    type: Object,
    required: true
  }
})

const currentIndex = ref(0)

const slides = computed(() => props.slideData?.slides || [])
const theme = computed(() => props.slideData?.theme || {})
const totalSlides = computed(() => slides.value.length)
const currentSlide = computed(() => slides.value[currentIndex.value] || {})

const primaryColor = computed(() => theme.value.primaryColor || '#2563eb')
const fontFamily = computed(() => theme.value.fontFamily || 'sans-serif')

function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}

function next() {
  if (currentIndex.value < totalSlides.value - 1) currentIndex.value++
}
</script>

<template>
  <div v-if="slides.length">
    <!-- Navigation header -->
    <div class="flex items-center justify-between mb-4">
      <p class="text-sm text-gray-500">
        Слайд {{ currentIndex + 1 }} из {{ totalSlides }}
      </p>
      <div class="flex gap-2">
        <button
          @click="prev"
          :disabled="currentIndex === 0"
          class="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          @click="next"
          :disabled="currentIndex === totalSlides - 1"
          class="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Slide card with 16:9 ratio -->
    <div
      class="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden"
      :style="{ fontFamily }"
    >
      <div class="relative w-full" style="padding-bottom: 56.25%">
        <div class="absolute inset-0 p-8 flex flex-col">

          <!-- Layout: title -->
          <template v-if="currentSlide.layout === 'title'">
            <div class="flex-1 flex flex-col items-center justify-center text-center">
              <h2
                class="text-4xl font-bold mb-4 leading-tight"
                :style="{ color: primaryColor }"
              >
                {{ currentSlide.title }}
              </h2>
              <p v-if="currentSlide.subtitle" class="text-xl text-gray-500">
                {{ currentSlide.subtitle }}
              </p>
            </div>
          </template>

          <!-- Layout: section -->
          <template v-else-if="currentSlide.layout === 'section'">
            <div class="flex-1 flex items-center justify-center text-center">
              <h2
                class="text-3xl font-bold"
                :style="{ color: primaryColor }"
              >
                {{ currentSlide.title || currentSlide.text }}
              </h2>
            </div>
          </template>

          <!-- Layout: content -->
          <template v-else-if="currentSlide.layout === 'content'">
            <h2
              class="text-2xl font-bold mb-6"
              :style="{ color: primaryColor }"
            >
              {{ currentSlide.title }}
            </h2>
            <div class="flex-1 flex gap-6">
              <ul class="flex-1 space-y-2">
                <li
                  v-for="(item, idx) in (currentSlide.bullets || currentSlide.body || [])"
                  :key="idx"
                  class="flex items-start gap-2 text-gray-700"
                >
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: primaryColor }"></span>
                  <span>{{ typeof item === 'string' ? item : item.text }}</span>
                </li>
              </ul>
              <div
                v-if="currentSlide.image"
                class="w-1/3 flex items-center justify-center bg-gray-100 rounded-lg"
              >
                <img
                  :src="currentSlide.image"
                  :alt="currentSlide.title"
                  class="max-h-full max-w-full object-contain rounded"
                  @error="($event) => $event.target.style.display = 'none'"
                />
                <span class="text-xs text-gray-400 p-2">{{ currentSlide.image }}</span>
              </div>
            </div>
          </template>

          <!-- Layout: image -->
          <template v-else-if="currentSlide.layout === 'image'">
            <h2
              class="text-2xl font-bold mb-4"
              :style="{ color: primaryColor }"
            >
              {{ currentSlide.title }}
            </h2>
            <div class="flex-1 flex items-center justify-center bg-gray-50 rounded-lg">
              <img
                v-if="currentSlide.image"
                :src="currentSlide.image"
                :alt="currentSlide.title"
                class="max-h-full max-w-full object-contain"
                @error="($event) => $event.target.replaceWith(document.createTextNode(currentSlide.image))"
              />
              <span class="text-sm text-gray-400">{{ currentSlide.image || 'Изображение' }}</span>
            </div>
          </template>

          <!-- Layout: two_column -->
          <template v-else-if="currentSlide.layout === 'two_column'">
            <h2
              class="text-2xl font-bold mb-6"
              :style="{ color: primaryColor }"
            >
              {{ currentSlide.title }}
            </h2>
            <div class="flex-1 grid grid-cols-2 gap-6">
              <div>
                <h3 v-if="currentSlide.left_title" class="font-semibold text-gray-900 mb-2">
                  {{ currentSlide.left_title }}
                </h3>
                <ul v-if="Array.isArray(currentSlide.left)" class="space-y-1.5">
                  <li
                    v-for="(item, idx) in currentSlide.left"
                    :key="idx"
                    class="flex items-start gap-2 text-sm text-gray-700"
                  >
                    <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: primaryColor }"></span>
                    <span>{{ typeof item === 'string' ? item : item.text }}</span>
                  </li>
                </ul>
                <p v-else class="text-sm text-gray-700">{{ currentSlide.left }}</p>
              </div>
              <div>
                <h3 v-if="currentSlide.right_title" class="font-semibold text-gray-900 mb-2">
                  {{ currentSlide.right_title }}
                </h3>
                <ul v-if="Array.isArray(currentSlide.right)" class="space-y-1.5">
                  <li
                    v-for="(item, idx) in currentSlide.right"
                    :key="idx"
                    class="flex items-start gap-2 text-sm text-gray-700"
                  >
                    <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: primaryColor }"></span>
                    <span>{{ typeof item === 'string' ? item : item.text }}</span>
                  </li>
                </ul>
                <p v-else class="text-sm text-gray-700">{{ currentSlide.right }}</p>
              </div>
            </div>
          </template>

          <!-- Default layout: title + body -->
          <template v-else>
            <h2
              class="text-2xl font-bold mb-4"
              :style="{ color: primaryColor }"
            >
              {{ currentSlide.title }}
            </h2>
            <div class="flex-1 text-gray-700 whitespace-pre-wrap">
              <template v-if="Array.isArray(currentSlide.body)">
                <ul class="space-y-2">
                  <li
                    v-for="(item, idx) in currentSlide.body"
                    :key="idx"
                    class="flex items-start gap-2"
                  >
                    <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: primaryColor }"></span>
                    <span>{{ typeof item === 'string' ? item : item.text }}</span>
                  </li>
                </ul>
              </template>
              <p v-else>{{ currentSlide.body || currentSlide.text || '' }}</p>
            </div>
          </template>

        </div>
      </div>
    </div>

    <!-- Slide thumbnails -->
    <div class="flex gap-2 mt-4 overflow-x-auto pb-2">
      <button
        v-for="(slide, idx) in slides"
        :key="idx"
        @click="currentIndex = idx"
        :class="[
          'shrink-0 w-20 h-12 rounded border-2 text-[9px] leading-tight p-1 truncate transition',
          idx === currentIndex
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 bg-white hover:border-gray-300'
        ]"
      >
        {{ slide.title || `Слайд ${idx + 1}` }}
      </button>
    </div>
  </div>
</template>
