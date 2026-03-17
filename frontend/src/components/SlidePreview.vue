<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  slideData: {
    type: Object,
    required: true
  }
})

const currentIndex = ref(0)
const frameworkCss = ref('')
const wrapperRef = ref(null)
const iframeScale = ref(0.5)

const SLIDE_W = 1920
const SLIDE_H = 1080

const slides = computed(() => props.slideData?.slides || [])
const theme = computed(() => props.slideData?.theme || {})
const totalSlides = computed(() => slides.value.length)

let resizeObserver = null

function updateScale() {
  if (!wrapperRef.value) return
  const containerWidth = wrapperRef.value.clientWidth
  iframeScale.value = containerWidth / SLIDE_W
}

onMounted(async () => {
  try {
    const res = await fetch('/converter/framework.css')
    if (res.ok) {
      frameworkCss.value = await res.text()
    } else {
      throw new Error('fetch failed')
    }
  } catch {
    frameworkCss.value = [
      '*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }',
      '.slide { width:1920px; height:1080px; padding:80px; font-family:"Inter",sans-serif;',
      '  display:flex; flex-direction:column; overflow:hidden; background:white; color:#1e293b; font-size:28px; line-height:1.5; }',
      '.centered { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; }',
      '.heading-xl { font-size:72px; font-weight:800; line-height:1.1; color:#2563eb; }',
      '.heading-lg { font-size:52px; font-weight:700; line-height:1.2; }',
      '.subtitle { font-size:32px; color:#64748b; }',
    ].join('\n')
  }

  await nextTick()
  updateScale()

  if (wrapperRef.value) {
    resizeObserver = new ResizeObserver(updateScale)
    resizeObserver.observe(wrapperRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
})

function buildSlideSrcdoc(slide) {
  const t = theme.value
  let fontImports = ''
  if (Array.isArray(t.fonts) && t.fonts.length > 0) {
    const families = t.fonts
      .map(f => 'family=' + f.replace(/ /g, '+') + ':wght@400;600;700;800')
      .join('&')
    fontImports = `<link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
${fontImports}
<style>
${frameworkCss.value}
body { margin:0; padding:0; background:white; overflow:hidden; }
.slide { margin:0 !important; box-shadow:none !important; }
</style>
<style>${t.css || ''}</style>
<style>${slide.css || ''}</style>
</head>
<body>
<div class="slide">${slide.html || ''}</div>
</body></html>`
}

const currentSrcdoc = computed(() => {
  const slide = slides.value[currentIndex.value]
  if (!slide || !frameworkCss.value) return ''
  return buildSlideSrcdoc(slide)
})

function getSlideTitle(slide, idx) {
  if (!slide.html) return `Слайд ${idx + 1}`
  const match = slide.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (match) {
    const text = match[1].replace(/<[^>]+>/g, '').trim()
    return text.length > 30 ? text.substring(0, 30) + '…' : text
  }
  return `Слайд ${idx + 1}`
}

function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}

function next() {
  if (currentIndex.value < totalSlides.value - 1) currentIndex.value++
}

watch(() => props.slideData, () => {
  currentIndex.value = 0
})
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

    <!-- Slide preview (16:9 container with scaled iframe) -->
    <div
      ref="wrapperRef"
      class="bg-gray-100 rounded-xl shadow-lg border border-gray-200 overflow-hidden"
    >
      <div class="relative w-full" style="padding-bottom: 56.25%">
        <div class="absolute inset-0 overflow-hidden">
          <iframe
            v-if="currentSrcdoc"
            :srcdoc="currentSrcdoc"
            :key="currentIndex"
            sandbox="allow-same-origin"
            class="border-0 origin-top-left"
            :style="{
              width: SLIDE_W + 'px',
              height: SLIDE_H + 'px',
              transform: `scale(${iframeScale})`,
              pointerEvents: 'none'
            }"
            frameborder="0"
            scrolling="no"
          ></iframe>
          <div v-else class="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            Загрузка превью...
          </div>
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
          'shrink-0 w-24 h-14 rounded border-2 text-[9px] leading-tight p-1 truncate transition',
          idx === currentIndex
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 bg-white hover:border-gray-300'
        ]"
      >
        {{ getSlideTitle(slide, idx) }}
      </button>
    </div>
  </div>
</template>
