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
    const attachments = ref([])

    const { aggregatedPayload } = usePromptAggregator({
      prompt,
      slideCount,
      slidePrompts,
      presentationSettings,
      systemPrompt,
      attachments
    })

    expect(aggregatedPayload.value).toEqual({
      prompt: 'Test prompt',
      slideCount: 5,
      slidePrompts: slidePrompts.value,
      presentationSettings: presentationSettings.value,
      systemPrompt: 'System prompt',
      attachments: [],
      designBrief: null,
      pipelineVersion: 2
    })
  })

  it('normalizes attachments from picker shape (id) to API shape (attachmentId)', () => {
    const prompt = ref('p')
    const attachments = ref([
      { id: 'aaa', description_snapshot: 'desc1', original_name: 'x.png' },
      { attachmentId: 'bbb', description: '  trim me  ' },
      { id: 'ccc' }
    ])

    const { aggregatedPayload } = usePromptAggregator({
      prompt,
      slideCount: ref(0),
      slidePrompts: ref([]),
      presentationSettings: ref({}),
      systemPrompt: ref(''),
      attachments
    })

    expect(aggregatedPayload.value.attachments).toEqual([
      { attachmentId: 'aaa', description: 'desc1' },
      { attachmentId: 'bbb', description: 'trim me' },
      { attachmentId: 'ccc', description: '' }
    ])
  })

  it('toFormData appends serialized attachments', () => {
    const attachments = ref([{ attachmentId: 'x', description: 'd' }])
    const { toFormData } = usePromptAggregator({
      prompt: ref('hello'),
      slideCount: ref(0),
      slidePrompts: ref([]),
      presentationSettings: ref({}),
      systemPrompt: ref(''),
      attachments
    })

    const fd = toFormData([])
    expect(fd.get('attachments')).toBe(
      JSON.stringify([{ attachmentId: 'x', description: 'd' }])
    )
    expect(fd.get('prompt')).toBe('hello')
  })

  it('works without attachments option (back-compat)', () => {
    const { aggregatedPayload, toFormData } = usePromptAggregator({
      prompt: ref('p'),
      slideCount: ref(0),
      slidePrompts: ref([]),
      presentationSettings: ref({}),
      systemPrompt: ref('')
    })

    expect(aggregatedPayload.value.attachments).toEqual([])
    const fd = toFormData([])
    expect(fd.get('attachments')).toBe('[]')
  })
})
