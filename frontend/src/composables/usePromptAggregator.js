import { computed } from 'vue'

export function usePromptAggregator({
  prompt,
  slideCount,
  slidePrompts,
  presentationSettings,
  systemPrompt,
  attachments,
}) {
  const aggregatedPayload = computed(() => ({
    prompt: (prompt?.value || '').trim(),
    slideCount: Number(slideCount?.value) || 0,
    slidePrompts: Array.isArray(slidePrompts?.value) ? slidePrompts.value : [],
    presentationSettings: presentationSettings?.value || {},
    systemPrompt: (systemPrompt?.value || '').trim() || null,
    attachments: normalizeAttachments(attachments?.value),
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

    formData.append('attachments', JSON.stringify(data.attachments))

    if (Array.isArray(files)) {
      files.forEach((file) => formData.append('files', file))
    }

    return formData
  }

  return {
    aggregatedPayload,
    toFormData,
  }
}

// Accepts either a list of objects {attachmentId, description} (already normalized)
// or a list of attachment rows {id, description_snapshot|description, ...} from the
// picker, and returns a stable, minimal shape for the API: [{attachmentId, description}].
function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry) return null
      const attachmentId =
        typeof entry.attachmentId === 'string'
          ? entry.attachmentId
          : typeof entry.id === 'string'
            ? entry.id
            : null
      if (!attachmentId) return null
      const description =
        typeof entry.description === 'string'
          ? entry.description
          : typeof entry.description_snapshot === 'string'
            ? entry.description_snapshot
            : ''
      return { attachmentId, description: description.trim() }
    })
    .filter(Boolean)
}
