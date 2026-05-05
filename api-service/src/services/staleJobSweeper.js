// Stale-job sweeper. Runs on a timer in src/index.js and flips any job that
// has been parked in a processing_* state for longer than the configured
// timeout into 'error'. Logic lives here (not in the timer callback) so it
// can be unit-tested with a fake query function.
//
// Why both legacy 'processing' and the new staged statuses are covered:
// pipeline v1 still uses bare 'processing'; pipeline v2 uses
// 'processing_planning' / '_design' / '_layout' / '_refine'. Without all of
// them in the sweep, a failed n8n execution leaves the UI spinner running
// forever (the hot-fix scenario from CHANGES.md §2).

const STALE_JOB_STATUSES = Object.freeze([
  'processing',
  'processing_planning',
  'processing_design',
  'processing_layout',
  'processing_refine',
]);

const STALE_STEP_STATUS = 'running';

const JOB_TIMEOUT_MESSAGE = 'Pipeline timeout: job exceeded processing window';
const STEP_TIMEOUT_MESSAGE =
  'Pipeline timeout: stage exceeded processing window';

const STATUS_PLACEHOLDERS = STALE_JOB_STATUSES.map(
  (s) => `'${s}'`,
).join(', ');

/**
 * Mark every job that has been "processing*" longer than `timeoutMinutes` as
 * `error`, then propagate the same error to any running pipeline step that
 * belongs to the affected jobs.
 *
 * @param {Object} args
 * @param {Function} args.query — pg-style async query(sql, params) function
 * @param {number}   args.timeoutMinutes — minutes to wait before erroring;
 *                                         clamped to a minimum of 1.
 * @returns {Promise<{staleJobIds: string[]}>}
 */
async function markStaleJobsAsError({ query, timeoutMinutes }) {
  const minutes = Math.max(1, Number(timeoutMinutes) || 0);

  const jobsResult = await query(
    `UPDATE presentator.jobs
        SET status = 'error',
            error_message = $1,
            updated_at = now()
      WHERE status IN (${STATUS_PLACEHOLDERS})
        AND updated_at < now() - ($2::text || ' minutes')::interval
      RETURNING id`,
    [JOB_TIMEOUT_MESSAGE, String(minutes)],
  );

  const staleJobIds = (jobsResult.rows || []).map((r) => r.id);
  if (staleJobIds.length === 0) {
    return { staleJobIds };
  }

  await query(
    `UPDATE presentator.job_pipeline_steps
        SET status = 'error',
            error_message = COALESCE(error_message, $1),
            completed_at = now()
      WHERE status = '${STALE_STEP_STATUS}'
        AND job_id = ANY($2::uuid[])`,
    [STEP_TIMEOUT_MESSAGE, staleJobIds],
  );

  return { staleJobIds };
}

module.exports = {
  STALE_JOB_STATUSES,
  STALE_STEP_STATUS,
  JOB_TIMEOUT_MESSAGE,
  STEP_TIMEOUT_MESSAGE,
  markStaleJobsAsError,
};
