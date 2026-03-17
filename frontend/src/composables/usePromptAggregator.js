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

  function toFormData(input) {
    const data = aggregatedPayload.value
    const formData = new FormData()

    formData.append('prompt', data.prompt)
    formData.append('slideCount', String(data.slideCount))
    formData.append('slidePrompts', JSON.stringify(data.slidePrompts))
    formData.append('presentationSettings', JSON.stringify(data.presentationSettings))
    if (data.systemPrompt) {
      formData.append('systemPrompt', data.systemPrompt)
    }

    const files = Array.isArray(input) ? input : (input?.files || [])
    const attachmentIds = Array.isArray(input?.attachmentIds) ? input.attachmentIds : []
    const filePrompts = Array.isArray(input?.filePrompts) ? input.filePrompts : []

    if (Array.isArray(files)) {
      files.forEach((file) => formData.append('files', file))
    }
    if (attachmentIds.length > 0) {
      formData.append('attachmentIds', JSON.stringify(attachmentIds))
    }
    if (filePrompts.length > 0) {
      formData.append('filePrompts', JSON.stringify(filePrompts))
    }

    return formData
  }

  return {
    aggregatedPayload,
    toFormData
  }
}

