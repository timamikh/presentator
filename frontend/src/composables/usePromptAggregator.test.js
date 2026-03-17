import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { usePromptAggregator } from './usePromptAggregator'

describe('usePromptAggregator', () => {
  it('aggregates prompt data into expected JSON structure', () => {
    const prompt = ref('  Test prompt  ')
    const slideCount = ref(5)
    const slidePrompts = ref([
      { slideIndex: 0, prompt: 'Title slide' },
      { slideIndex: 1, prompt: 'Content' }
    ])
    const presentationSettings = ref({
      fontFamily: 'Arial',
      primaryColor: '#2563eb'
    })
    const systemPrompt = ref('System prompt')

    const { aggregatedPayload } = usePromptAggregator({
      prompt,
      slideCount,
      slidePrompts,
      presentationSettings,
      systemPrompt
    })

    expect(aggregatedPayload.value).toEqual({
      prompt: 'Test prompt',
      slideCount: 5,
      slidePrompts: slidePrompts.value,
      presentationSettings: presentationSettings.value,
      systemPrompt: 'System prompt'
    })
  })

  it('adds attachmentIds and filePrompts into FormData', () => {
    const prompt = ref('Test')
    const slideCount = ref(0)
    const slidePrompts = ref([])
    const presentationSettings = ref({})
    const systemPrompt = ref('')

    const { toFormData } = usePromptAggregator({
      prompt,
      slideCount,
      slidePrompts,
      presentationSettings,
      systemPrompt
    })

    const formData = toFormData({
      files: [],
      attachmentIds: ['11111111-1111-1111-1111-111111111111'],
      filePrompts: [{ attachmentId: '11111111-1111-1111-1111-111111111111', prompt: 'use it' }]
    })

    expect(formData.get('attachmentIds')).toBe(JSON.stringify(['11111111-1111-1111-1111-111111111111']))
    expect(formData.get('filePrompts')).toBe(
      JSON.stringify([{ attachmentId: '11111111-1111-1111-1111-111111111111', prompt: 'use it' }])
    )
  })
})

