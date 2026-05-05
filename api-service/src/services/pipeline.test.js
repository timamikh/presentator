const test = require('node:test');
const assert = require('node:assert/strict');

// Import from pipelineStages (pure constants) — services/pipeline.js itself
// requires db / config which need env-vars to load. The DB-dependent helpers
// (startStage / completeStage) are exercised via the running stack.
const {
  STAGES,
  isStage,
  ALLOWED_TRANSITIONS,
  STAGE_TO_PROMPT_KEY,
  STAGE_TO_PROCESSING_STATUS,
  STAGE_TO_RESULT_FIELD,
  STAGE_TO_AWAITING_STATUS,
  assertTransitionAllowed,
} = require('./pipelineStages');

test('STAGES contains the four pipeline stages', () => {
  assert.deepEqual([...STAGES].sort(), [
    'design',
    'layout',
    'planning',
    'refine_layout',
  ]);
});

test('isStage filters out unknown values', () => {
  assert.equal(isStage('planning'), true);
  assert.equal(isStage('design'), true);
  assert.equal(isStage('layout'), true);
  assert.equal(isStage('refine_layout'), true);
  assert.equal(isStage('render'), false);
  assert.equal(isStage(''), false);
  assert.equal(isStage(null), false);
  assert.equal(isStage(42), false);
});

// ── ALLOWED_TRANSITIONS keyed by jobs.status (single source of truth) ───
//
// Hotfix: the previous version compared current_stage against transition values
// from jobs.status, which never matched (current_stage is always
// 'planning'/'design'/...). Using jobs.status as the source of truth means
// the user's "Continue" action only succeeds when the job is parked in the
// correct review state.

test('Planning may start from null/pending (new job), an existing planning attempt or after error', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.planning, [
    null,
    'pending',
    'awaiting_planning_review',
    'error',
  ]);
});

test('Design may start from awaiting_planning_review or after a failed attempt', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.design, [
    'awaiting_planning_review',
    'error',
  ]);
});

test('Layout may start from awaiting_design_review or after a failed attempt', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.layout, [
    'awaiting_design_review',
    'error',
  ]);
});

test('Refine may start from done or after a previous refine error', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.refine_layout, [
    'done',
    'error',
  ]);
});

test('every stage has a corresponding prompt key', () => {
  for (const stage of STAGES) {
    assert.ok(STAGE_TO_PROMPT_KEY[stage], `missing prompt key for ${stage}`);
    assert.match(STAGE_TO_PROMPT_KEY[stage], /^default_\w+_prompt$/);
  }
});

test('every stage has a processing status', () => {
  for (const stage of STAGES) {
    assert.ok(STAGE_TO_PROCESSING_STATUS[stage]);
    assert.match(STAGE_TO_PROCESSING_STATUS[stage], /^processing_/);
  }
});

test('STAGE_TO_RESULT_FIELD maps each stage to a job column', () => {
  assert.equal(STAGE_TO_RESULT_FIELD.planning, 'planning_result');
  assert.equal(STAGE_TO_RESULT_FIELD.design, 'design_brief');
  assert.equal(STAGE_TO_RESULT_FIELD.layout, 'slide_data');
  assert.equal(STAGE_TO_RESULT_FIELD.refine_layout, 'slide_data');
});

test('STAGE_TO_AWAITING_STATUS maps each stage to next status', () => {
  assert.equal(STAGE_TO_AWAITING_STATUS.planning, 'awaiting_planning_review');
  assert.equal(STAGE_TO_AWAITING_STATUS.design, 'awaiting_design_review');
  assert.equal(STAGE_TO_AWAITING_STATUS.layout, 'done');
  assert.equal(STAGE_TO_AWAITING_STATUS.refine_layout, 'done');
});

// ── assertTransitionAllowed: pure guard helper used by startStage ──────

test('assertTransitionAllowed is a no-op for valid transitions', () => {
  assert.doesNotThrow(() => assertTransitionAllowed('planning', null));
  assert.doesNotThrow(() => assertTransitionAllowed('planning', 'pending'));
  assert.doesNotThrow(() =>
    assertTransitionAllowed('design', 'awaiting_planning_review'),
  );
  assert.doesNotThrow(() =>
    assertTransitionAllowed('layout', 'awaiting_design_review'),
  );
  assert.doesNotThrow(() => assertTransitionAllowed('refine_layout', 'done'));
});

test('assertTransitionAllowed throws a 409 with status info for the design→planning regression', () => {
  // This is the exact scenario we shipped broken: user clicks "Continue" while
  // the job is awaiting planning review, but old code compared against
  // current_stage='planning' and rejected the move to design.
  assert.throws(
    () => assertTransitionAllowed('design', 'processing_planning'),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Stage design not allowed from status=processing_planning/);
      return true;
    },
  );
});

test('assertTransitionAllowed rejects layout from awaiting_planning_review', () => {
  assert.throws(
    () => assertTransitionAllowed('layout', 'awaiting_planning_review'),
    (err) => {
      assert.equal(err.status, 409);
      return true;
    },
  );
});

test('assertTransitionAllowed allows design retry after error (UI "try again")', () => {
  // After a failed design attempt the job sits at status='error'; the user
  // should be able to hit "Continue" again without manual DB surgery.
  assert.doesNotThrow(() => assertTransitionAllowed('design', 'error'));
  assert.doesNotThrow(() => assertTransitionAllowed('layout', 'error'));
});

test('assertTransitionAllowed rejects refine while a previous refine is still running', () => {
  assert.throws(
    () => assertTransitionAllowed('refine_layout', 'processing_refine'),
    (err) => {
      assert.equal(err.status, 409);
      return true;
    },
  );
});

test('assertTransitionAllowed rejects unknown stages with 400', () => {
  assert.throws(
    () => assertTransitionAllowed('render', 'done'),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    },
  );
});
