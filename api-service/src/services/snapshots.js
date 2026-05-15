// Job snapshots: full point-in-time copies of a job's user-facing state.
//
// Snapshots back the "versions" panel in the UI:
//   • completeStage() creates an auto-snapshot after every successful stage.
//   • Users can create manual snapshots (POST /api/jobs/:id/snapshots).
//   • restoreSnapshot() copies a snapshot's contents back to jobs.* and writes
//     a follow-up snapshot row with kind='restore' so the audit trail stays
//     linear (Git-style, never "rewind history").
//
// All helpers are pure (or take an injected query) so they can be unit-tested
// without a live DB.

const AUTO_LABELS = {
  planning: 'После планирования',
  design: 'После дизайна',
  layout: 'После верстки',
  refine_layout: 'После доработки',
};

const STAGE_KINDS = new Set(['auto', 'manual', 'restore']);

function buildAutoLabel({ stage, attempt }) {
  const base = AUTO_LABELS[stage] || stage;
  return `${base} (попытка ${attempt})`;
}

function computeNextVersion(rows) {
  let max = 0;
  for (const r of rows || []) {
    const v = Number(r.version);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max + 1;
}

function asJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Build the params array for the snapshot INSERT statement. Pure; tested
 * directly so we don't have to spin up the whole pipeline to verify the
 * mapping job-column → snapshot-column.
 */
function buildSnapshotInsertParams({
  jobId,
  version,
  kind,
  label = null,
  stage = null,
  job,
  createdByStepId = null,
  createdByUserId = null,
}) {
  return [
    jobId,                                       // $1 job_id
    version,                                     // $2 version
    kind,                                        // $3 kind
    label,                                       // $4 label
    stage,                                       // $5 stage
    job.status || null,                          // $6 status
    job.current_stage || null,                   // $7 current_stage
    job.prompt || null,                          // $8 prompt
    job.slide_count ?? null,                     // $9 slide_count
    asJson(job.slide_prompts),                   // $10 slide_prompts
    asJson(job.presentation_settings),           // $11 presentation_settings
    job.system_prompt || null,                   // $12 system_prompt
    asJson(job.design_input),                    // $13 design_input
    asJson(job.planning_result),                 // $14 planning_result
    asJson(job.design_brief),                    // $15 design_brief
    asJson(job.slide_data),                      // $16 slide_data
    asJson(job.result_paths),                    // $17 result_paths
    createdByStepId,                             // $18 created_by_step_id
    createdByUserId,                             // $19 created_by_user_id
  ];
}

const SNAPSHOT_INSERT_SQL = `
  INSERT INTO presentator.job_snapshots (
    job_id, version, kind, label, stage, status, current_stage,
    prompt, slide_count, slide_prompts, presentation_settings, system_prompt,
    design_input, planning_result, design_brief, slide_data, result_paths,
    created_by_step_id, created_by_user_id
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10::jsonb, $11::jsonb, $12,
    $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
    $18, $19
  )
  RETURNING id, version, kind, label, stage, status, current_stage,
            created_at, created_by_user_id, created_by_step_id
`;

const JOB_SELECT_SQL = `
  SELECT id, status, current_stage, prompt, slide_count, slide_prompts,
         presentation_settings, system_prompt, design_input,
         planning_result, design_brief, slide_data, result_paths
    FROM presentator.jobs
   WHERE id = $1
`;

const NEXT_VERSION_SQL = `
  SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM presentator.job_snapshots
   WHERE job_id = $1
`;

/**
 * Create a snapshot for the current state of a job.
 *
 * @param {Object} input
 * @param {string} input.jobId
 * @param {'auto'|'manual'|'restore'} input.kind
 * @param {string} [input.label]
 * @param {string} [input.stage]
 * @param {number} [input.attempt] — used to autogenerate a label for auto snapshots
 * @param {string|null} [input.createdByStepId]
 * @param {string|null} [input.createdByUserId]
 * @param {Object} deps
 * @param {Function} deps.query
 */
async function createSnapshot(input, { query } = {}) {
  if (!STAGE_KINDS.has(input.kind)) {
    const err = new Error(`Unknown snapshot kind: ${input.kind}`);
    err.status = 400;
    throw err;
  }
  if (!input.jobId) {
    const err = new Error('jobId is required');
    err.status = 400;
    throw err;
  }

  const jobRes = await query(JOB_SELECT_SQL, [input.jobId]);
  if (!jobRes.rows || jobRes.rows.length === 0) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  const job = jobRes.rows[0];

  const verRes = await query(NEXT_VERSION_SQL, [input.jobId]);
  const version = Number(verRes.rows?.[0]?.next_version) || 1;

  let label = input.label || null;
  if (!label && input.kind === 'auto' && input.stage) {
    label = buildAutoLabel({ stage: input.stage, attempt: input.attempt || 1 });
  }

  const params = buildSnapshotInsertParams({
    jobId: input.jobId,
    version,
    kind: input.kind,
    label,
    stage: input.stage || null,
    job,
    createdByStepId: input.createdByStepId || null,
    createdByUserId: input.createdByUserId || null,
  });

  const insertRes = await query(SNAPSHOT_INSERT_SQL, params);
  return insertRes.rows[0];
}

const LIST_SNAPSHOTS_SQL = `
  SELECT id, version, kind, label, stage, status, current_stage,
         created_at, created_by_step_id, created_by_user_id
    FROM presentator.job_snapshots
   WHERE job_id = $1
   ORDER BY version DESC
`;

async function listSnapshots(jobId, { query } = {}) {
  const res = await query(LIST_SNAPSHOTS_SQL, [jobId]);
  return res.rows || [];
}

const GET_SNAPSHOT_SQL = `
  SELECT *
    FROM presentator.job_snapshots
   WHERE job_id = $1 AND version = $2
`;

const GET_SNAPSHOT_FULL_SQL = `
  SELECT *
    FROM presentator.job_snapshots
   WHERE id = $1
`;

async function getSnapshotByVersion(jobId, version, { query } = {}) {
  const res = await query(GET_SNAPSHOT_SQL, [jobId, version]);
  return res.rows?.[0] || null;
}

async function getSnapshotById(id, { query } = {}) {
  const res = await query(GET_SNAPSHOT_FULL_SQL, [id]);
  return res.rows?.[0] || null;
}

/**
 * Build the SET clause and params array for restoring a snapshot onto jobs.*.
 * Pure (no DB), so we can verify the column set in unit tests.
 *
 * Returns {sets: string[], params: any[]}. Each `$N` placeholder is 1-based
 * and contiguous: the caller appends WHERE id = $N+1 and supplies job_id.
 */
function pickRestoreFields(snapshot) {
  const fields = [
    { col: 'prompt',                value: snapshot.prompt ?? null,                jsonb: false },
    { col: 'slide_count',           value: snapshot.slide_count ?? 0,              jsonb: false },
    { col: 'slide_prompts',         value: asJson(snapshot.slide_prompts),         jsonb: true },
    { col: 'presentation_settings', value: asJson(snapshot.presentation_settings), jsonb: true },
    { col: 'system_prompt',         value: snapshot.system_prompt ?? null,         jsonb: false },
    { col: 'design_input',          value: asJson(snapshot.design_input),          jsonb: true },
    { col: 'planning_result',       value: asJson(snapshot.planning_result),       jsonb: true },
    { col: 'design_brief',          value: asJson(snapshot.design_brief),          jsonb: true },
    { col: 'slide_data',            value: asJson(snapshot.slide_data),            jsonb: true },
    { col: 'status',                value: snapshot.status || 'awaiting_planning_review', jsonb: false },
    { col: 'current_stage',         value: snapshot.current_stage || null,         jsonb: false },
  ];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const f of fields) {
    if (f.jsonb) {
      sets.push(`${f.col} = $${idx++}::jsonb`);
    } else {
      sets.push(`${f.col} = $${idx++}`);
    }
    params.push(f.value);
  }
  return { sets, params };
}

/**
 * Apply a snapshot to the live job (UPDATE jobs) and write a follow-up
 * "restore" snapshot so the audit trail stays linear.
 *
 * @returns {{restoredFromVersion: number, newVersion: number, snapshotId: string}}
 */
async function restoreSnapshot({ jobId, version, userId = null }, { query } = {}) {
  const snap = await getSnapshotByVersion(jobId, version, { query });
  if (!snap) {
    const err = new Error('Snapshot not found');
    err.status = 404;
    throw err;
  }

  const { sets, params } = pickRestoreFields(snap);
  const whereIdx = params.length + 1;
  params.push(jobId);

  await query(
    `UPDATE presentator.jobs
        SET ${sets.join(', ')}, updated_at = now(), error_message = NULL
      WHERE id = $${whereIdx}`,
    params,
  );

  // Re-read the job so the follow-up snapshot reflects the just-applied state.
  const jobRes = await query(JOB_SELECT_SQL, [jobId]);
  const job = jobRes.rows[0];

  const verRes = await query(NEXT_VERSION_SQL, [jobId]);
  const newVersion = Number(verRes.rows?.[0]?.next_version) || 1;

  const insertParams = buildSnapshotInsertParams({
    jobId,
    version: newVersion,
    kind: 'restore',
    label: `Откат к версии ${version}`,
    stage: snap.stage || null,
    job,
    createdByStepId: null,
    createdByUserId: userId,
  });
  const insertRes = await query(SNAPSHOT_INSERT_SQL, insertParams);

  return {
    restoredFromVersion: Number(snap.version),
    newVersion,
    snapshotId: insertRes.rows[0].id,
  };
}

module.exports = {
  AUTO_LABELS,
  buildAutoLabel,
  computeNextVersion,
  buildSnapshotInsertParams,
  pickRestoreFields,
  createSnapshot,
  listSnapshots,
  getSnapshotByVersion,
  getSnapshotById,
  restoreSnapshot,
  // SQL exposed for callers that need to chain inside a transaction.
  SNAPSHOT_INSERT_SQL,
  JOB_SELECT_SQL,
  NEXT_VERSION_SQL,
};
