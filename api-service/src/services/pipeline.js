// Pipeline orchestration helpers used by routes/jobs.js.
//
// The staged pipeline (v2) splits generation into Planning → Design → Layout
// with optional Refinement afterwards. Each stage is triggered by a webhook
// to n8n and tracked as a row in presentator.job_pipeline_steps.
//
// This module is the single point that:
//   - Validates stage transitions (raises 409 on conflicts).
//   - Builds and POSTs the webhook payload (with secrets + metadata).
//   - Atomically updates jobs.status / current_stage and inserts the new step.
//
// Routes layer (routes/jobs.js) only calls into here; n8n callbacks go through
// PATCH /api/jobs/internal/:id/steps/:stage which lives in routes/jobs.js.

const fetch = require('node-fetch');
const config = require('../config');
const { pool, query } = require('../db');
const { getOrSeedPrompt } = require('../routes/settings');
const {
  STAGES,
  STAGE_TO_PROMPT_KEY,
  STAGE_TO_PROCESSING_STATUS,
  STAGE_TO_RESULT_FIELD,
  STAGE_TO_AWAITING_STATUS,
  ALLOWED_TRANSITIONS,
  isStage,
  assertTransitionAllowed,
} = require('./pipelineStages');

async function loadJobAttachments(jobId) {
  const result = await query(
    `SELECT a.id, a.ref, a.original_name, a.storage_path, a.mime_type,
            a.file_size, a.kind, a.width, a.height, a.content_summary,
            ja.description_snapshot, ja.sort_order
       FROM presentator.job_attachments ja
       JOIN presentator.attachments a ON a.id = ja.attachment_id
      WHERE ja.job_id = $1
      ORDER BY ja.sort_order, ja.created_at`,
    [jobId],
  );

  const attachments = [];
  const attachmentMap = {};

  for (const row of result.rows) {
    attachments.push({
      ref: row.ref,
      kind: row.kind,
      filename: row.original_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      description: row.description_snapshot || null,
      summary: row.content_summary || null,
      width: row.width,
      height: row.height,
    });
    attachmentMap[row.ref] = {
      id: row.id,
      localPath: row.storage_path,
      mimeType: row.mime_type,
      filename: row.original_name,
    };
  }

  return { attachments, attachmentMap };
}

async function loadAllStages(jobId) {
  const result = await query(
    `SELECT stage, attempt, status, output, error_message, completed_at
       FROM presentator.job_pipeline_steps
      WHERE job_id = $1
      ORDER BY stage, attempt`,
    [jobId],
  );
  return result.rows;
}

function pickLatestOutputs(steps) {
  // Latest "done" output per stage. Used to feed downstream stages.
  const out = {};
  for (const step of steps) {
    if (step.status !== 'done' || !step.output) continue;
    out[step.stage] = step.output;
  }
  return out;
}

/**
 * Start a stage execution. Atomically:
 *   - validates the requested transition,
 *   - updates jobs.status to processing_<stage>,
 *   - inserts a new job_pipeline_steps row (attempt = max+1),
 *   - fires the n8n webhook with `stage` set.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {string} params.stage  one of STAGES
 * @param {Object|undefined} params.overrides — user edits for prior outputs
 *        (e.g. { planning_result, design_brief, refinePrompt, slideIndex })
 * @returns {Promise<{step, status, currentStage}>}
 */
async function startStage({ jobId, stage, overrides = {} }) {
  if (!isStage(stage)) {
    const err = new Error(`Unknown stage: ${stage}`);
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  let attempt;
  let processingStatus;
  let webhookPayload;

  try {
    await client.query('BEGIN');

    const jobRes = await client.query(
      `SELECT id, user_id, prompt, slide_count, slide_prompts, presentation_settings,
              system_prompt, current_stage, status, planning_result, design_brief,
              design_input, slide_data, pipeline_version
         FROM presentator.jobs
        WHERE id = $1
        FOR UPDATE`,
      [jobId],
    );
    if (jobRes.rows.length === 0) {
      const err = new Error('Job not found');
      err.status = 404;
      throw err;
    }
    const job = jobRes.rows[0];

    // Guard transitions by jobs.status (the source of truth). current_stage is
    // a UI-only hint set by completeStage and was the cause of the regression
    // "Stage design not allowed from current_stage=planning".
    assertTransitionAllowed(stage, job.status);

    if (overrides.planning_result !== undefined) {
      await client.query(
        `UPDATE presentator.jobs
            SET planning_result = $1, updated_at = now()
          WHERE id = $2`,
        [JSON.stringify(overrides.planning_result), jobId],
      );
      job.planning_result = overrides.planning_result;
    }

    if (overrides.design_brief !== undefined) {
      await client.query(
        `UPDATE presentator.jobs
            SET design_brief = $1, updated_at = now()
          WHERE id = $2`,
        [JSON.stringify(overrides.design_brief), jobId],
      );
      job.design_brief = overrides.design_brief;
    }

    const attemptRes = await client.query(
      `SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt
         FROM presentator.job_pipeline_steps
        WHERE job_id = $1 AND stage = $2`,
      [jobId, stage],
    );
    attempt = attemptRes.rows[0].next_attempt;

    processingStatus = STAGE_TO_PROCESSING_STATUS[stage];

    await client.query(
      `INSERT INTO presentator.job_pipeline_steps
         (job_id, stage, attempt, status, started_at)
       VALUES ($1, $2, $3, 'running', now())`,
      [jobId, stage, attempt],
    );

    // Clear stale error_message from a previous failed attempt — otherwise
    // the UI keeps showing the old error banner while a new attempt is in
    // flight (cosmetic, but confusing).
    await client.query(
      `UPDATE presentator.jobs
          SET status = $1, current_stage = $2, error_message = NULL,
              updated_at = now()
        WHERE id = $3`,
      [processingStatus, stage, jobId],
    );

    const promptKey = STAGE_TO_PROMPT_KEY[stage];
    const stagePrompt = job.system_prompt && stage === 'layout'
      ? job.system_prompt
      : await getOrSeedPrompt(promptKey);

    const { attachments, attachmentMap } = await loadJobAttachments(jobId);

    webhookPayload = {
      jobId,
      stage,
      attempt,
      prompt: job.prompt,
      promptMeta: {
        slideCount: job.slide_count,
        slidePrompts: job.slide_prompts || [],
        presentationSettings: job.presentation_settings || {},
        systemPrompt: stagePrompt,
        designBrief: job.design_brief || null,
        designInput: job.design_input || null,
        planningResult: job.planning_result || null,
        slideData: job.slide_data || null,
        refinePrompt: overrides.refinePrompt || null,
        slideIndex:
          typeof overrides.slideIndex === 'number' ? overrides.slideIndex : null,
      },
      attachments,
      attachmentMap,
      _secrets: {
        internalApiKey: config.internalApiKey,
        llmApiKey: process.env.LLM_API_KEY || '',
        llmBaseUrl: process.env.LLM_BASE_URL || 'https://openai-hub.neuraldeep.tech/v1',
        llmModel: process.env.LLM_MODEL || 'qwen3-30b-a3b-instruct-2507',
      },
    };

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }

  fetch(config.n8nWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
  }).catch((err) => {
    console.error(`n8n webhook failed for job ${jobId} stage=${stage}:`, err.message);
  });

  return { stage, attempt, status: processingStatus };
}

/**
 * Persist the output of a finished stage. Called by n8n via internal API.
 *
 * The function:
 *   - finds the latest "running" step for this stage and marks it done,
 *   - writes the output into the stage-specific column on jobs,
 *   - updates jobs.status to awaiting_<stage>_review (or 'done' for layout),
 *   - updates jobs.current_stage to mark a stop point.
 */
async function completeStage({ jobId, stage, output, llmRequest, llmResponse, errorMessage }) {
  if (!isStage(stage)) {
    const err = new Error(`Unknown stage: ${stage}`);
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stepRes = await client.query(
      `SELECT id, attempt FROM presentator.job_pipeline_steps
        WHERE job_id = $1 AND stage = $2
        ORDER BY attempt DESC
        LIMIT 1
        FOR UPDATE`,
      [jobId, stage],
    );
    if (stepRes.rows.length === 0) {
      const err = new Error('No running step found for this stage');
      err.status = 404;
      throw err;
    }
    const step = stepRes.rows[0];

    const nextStatus = errorMessage ? 'error' : 'done';
    await client.query(
      `UPDATE presentator.job_pipeline_steps
          SET status = $1, output = $2, llm_request = $3, llm_response = $4,
              error_message = $5, completed_at = now()
        WHERE id = $6`,
      [
        nextStatus,
        output === undefined ? null : JSON.stringify(output),
        llmRequest === undefined ? null : JSON.stringify(llmRequest),
        llmResponse === undefined ? null : JSON.stringify(llmResponse),
        errorMessage || null,
        step.id,
      ],
    );

    if (errorMessage) {
      await client.query(
        `UPDATE presentator.jobs
            SET status = 'error', error_message = $1, updated_at = now()
          WHERE id = $2`,
        [errorMessage, jobId],
      );
    } else if (output !== undefined && output !== null) {
      const field = STAGE_TO_RESULT_FIELD[stage];
      const awaiting = STAGE_TO_AWAITING_STATUS[stage];
      await client.query(
        `UPDATE presentator.jobs
            SET ${field} = $1,
                status = $2,
                current_stage = $3,
                updated_at = now()
          WHERE id = $4`,
        [JSON.stringify(output), awaiting, stage, jobId],
      );

      // Also keep the legacy llm_request / llm_response on jobs in sync with
      // the latest layout/refine step so the existing log viewer keeps working.
      if (stage === 'layout' || stage === 'refine_layout') {
        await client.query(
          `UPDATE presentator.jobs
              SET llm_request = $1, llm_response = $2, updated_at = now()
            WHERE id = $3`,
          [
            llmRequest === undefined ? null : JSON.stringify(llmRequest),
            llmResponse === undefined ? null : JSON.stringify(llmResponse),
            jobId,
          ],
        );
      }
    }

    await client.query('COMMIT');
    return { stage, attempt: step.attempt, status: nextStatus };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  STAGES,
  isStage,
  startStage,
  completeStage,
  loadAllStages,
  pickLatestOutputs,
  loadJobAttachments,
  ALLOWED_TRANSITIONS,
};
