// Pure constants for the staged pipeline. Kept in a separate module so unit
// tests can require them without pulling in db / config / fetch (which need
// env-vars to load).

const STAGES = ['planning', 'design', 'layout', 'refine_layout'];

const STAGE_TO_PROMPT_KEY = {
  planning: 'default_planning_prompt',
  design: 'default_design_prompt',
  layout: 'default_layout_prompt',
  refine_layout: 'default_refine_prompt',
};

const STAGE_TO_PROCESSING_STATUS = {
  planning: 'processing_planning',
  design: 'processing_design',
  layout: 'processing_layout',
  refine_layout: 'processing_refine',
};

const STAGE_TO_RESULT_FIELD = {
  planning: 'planning_result',
  design: 'design_brief',
  layout: 'slide_data',
  refine_layout: 'slide_data',
};

const STAGE_TO_AWAITING_STATUS = {
  planning: 'awaiting_planning_review',
  design: 'awaiting_design_review',
  layout: 'done',
  refine_layout: 'done',
};

// Hotfix: transitions are now keyed by `jobs.status` (single source of truth),
// not by `current_stage`. The previous version compared current_stage against
// status-shaped values (e.g. 'awaiting_planning_review') and never matched, so
// every "Continue" action returned 409. current_stage is now treated as a
// pure UI hint set by completeStage.
//
// 'planning' allows null/'pending' for fresh jobs, 'awaiting_planning_review'
// for re-runs from the review screen, and 'error' so a failed planning attempt
// can be retried without manual DB surgery.
const ALLOWED_TRANSITIONS = {
  planning: [null, 'pending', 'awaiting_planning_review', 'error'],
  design: ['awaiting_planning_review', 'error'],
  layout: ['awaiting_design_review', 'error'],
  refine_layout: ['done', 'error'],
};

function isStage(value) {
  return typeof value === 'string' && STAGES.includes(value);
}

/**
 * Throws a tagged error if `currentStatus` (jobs.status) is not in the allow
 * list for `stage`. Errors carry an `.status` property used by the route
 * layer to map onto an HTTP code (400 for unknown stage, 409 for conflict).
 *
 * @param {string} stage         one of STAGES
 * @param {string|null} currentStatus  current jobs.status value
 */
function assertTransitionAllowed(stage, currentStatus) {
  if (!isStage(stage)) {
    const err = new Error(`Unknown stage: ${stage}`);
    err.status = 400;
    throw err;
  }
  const allowed = ALLOWED_TRANSITIONS[stage] || [];
  if (!allowed.includes(currentStatus)) {
    const err = new Error(
      `Stage ${stage} not allowed from status=${currentStatus}`,
    );
    err.status = 409;
    throw err;
  }
}

module.exports = {
  STAGES,
  STAGE_TO_PROMPT_KEY,
  STAGE_TO_PROCESSING_STATUS,
  STAGE_TO_RESULT_FIELD,
  STAGE_TO_AWAITING_STATUS,
  ALLOWED_TRANSITIONS,
  isStage,
  assertTransitionAllowed,
};
