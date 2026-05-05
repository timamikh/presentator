<script setup>
// Visual stepper for the staged pipeline. Highlights the current stage based
// on jobs.current_stage / status, marks completed stages with a check, and
// shows error state when status === 'error'. Read-only.

import { computed } from 'vue'

const props = defineProps({
  status: { type: String, required: true },
  currentStage: { type: String, default: null },
})

const STEPS = [
  { id: 'planning', label: 'Планирование' },
  { id: 'design', label: 'Дизайн' },
  { id: 'layout', label: 'Верстка' },
  { id: 'render', label: 'Рендер' },
]

// Map status / current_stage onto an index range:
//   - state[i] === 'done' → checkmark
//   - state[i] === 'active' → spinner / blue ring
//   - state[i] === 'pending' → muted
//   - state[i] === 'error' → red
function computeStates(status, currentStage) {
  const out = STEPS.map(() => 'pending')

  if (status === 'error') {
    const stage = currentStage || 'planning'
    const idx = STEPS.findIndex((s) => s.id === stage)
    for (let i = 0; i < idx; i++) out[i] = 'done'
    if (idx >= 0) out[idx] = 'error'
    return out
  }

  if (status === 'done') {
    return STEPS.map(() => 'done')
  }

  // For pending / processing / awaiting_*: walk through stages and mark the
  // current one active, predecessors done.
  const stage = currentStage || (status === 'pending' ? 'planning' : 'planning')
  const idx = STEPS.findIndex((s) => s.id === stage)
  if (idx === -1) {
    out[0] = 'active'
    return out
  }

  for (let i = 0; i < idx; i++) out[i] = 'done'
  out[idx] = 'active'

  // awaiting_*_review = stage finished its LLM run, waiting for user.
  if (status === 'awaiting_planning_review' || status === 'awaiting_design_review') {
    out[idx] = 'done'
    if (idx + 1 < out.length) out[idx + 1] = 'active'
  }

  return out
}

const states = computed(() => computeStates(props.status, props.currentStage))
</script>

<template>
  <ol class="flex items-center w-full">
    <li
      v-for="(step, i) in STEPS"
      :key="step.id"
      :class="[
        'flex-1 flex items-center',
        i < STEPS.length - 1 ? 'after:flex-1 after:h-0.5 after:bg-gray-200 after:ml-2' : ''
      ]"
    >
      <span
        :class="[
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
          states[i] === 'done' && 'bg-green-50 text-green-700 border-green-200',
          states[i] === 'active' && 'bg-blue-50 text-blue-700 border-blue-200',
          states[i] === 'pending' && 'bg-gray-50 text-gray-400 border-gray-200',
          states[i] === 'error' && 'bg-red-50 text-red-700 border-red-200',
        ]"
      >
        <span v-if="states[i] === 'done'">✓</span>
        <span
          v-else-if="states[i] === 'active'"
          class="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"
        />
        <span v-else-if="states[i] === 'error'">!</span>
        <span v-else class="inline-block w-2 h-2 rounded-full bg-gray-300" />
        {{ step.label }}
      </span>
    </li>
  </ol>
</template>
