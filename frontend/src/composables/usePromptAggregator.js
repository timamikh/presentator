import { computed } from 'vue'

export function usePromptAggregator({
  prompt,
  slideCount,
  slidePrompts,
  presentationSettings,
  systemPrompt
}) {
  const aggregatedPayload = computed(() => ({
    prompt: (prompt?.value || '').trim(),
    slideCount: Number(slideCount?.value) || 0,
    slidePrompts: Array.isArray(slidePrompts?.value) ? slidePrompts.value : [],
    presentationSettings: presentationSettings?.value || {},
    systemPrompt: (systemPrompt?.value || '').trim() || null
  }))

  function toFormData(files) {
    const data = aggregatedPayload.value
    const formData = new FormData()

    formData.append('prompt', data.prompt)
    formData.append('slideCount', String(data.slideCount))
    formData.append('slidePrompts', JSON.stringify(data.slidePrompts))
    formData.append('presentationSettings', JSON.stringify(data.presentationSettings))
    if (data.systemPrompt) {
      formData.append('systemPrompt', data.systemPrompt)
    }

    if (Array.isArray(files)) {
      files.forEach((file) => formData.append('files', file))
    }

    return formData
  }

  return {
    aggregatedPayload,
    toFormData
  }
}

