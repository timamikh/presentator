// Draft form state for /create. Decoupled from `jobs` because a draft is
// just user input that hasn't been submitted to the pipeline yet. Drafts
// have their own version history (job_draft_versions): every save bumps
// head_version on the parent and inserts a row in versions.
//
// Public surface:
//   • createDraft(input, deps) → first version row + parent row
//   • updateDraft(input, deps) → bumps head_version, writes new version
//   • listDrafts(userId, deps)
//   • getDraft(userId, draftId, deps)
//   • listDraftVersions(userId, draftId, deps)
//   • restoreDraftVersion(input, deps) → copies a past version onto parent
//   • deleteDraft(userId, draftId, deps)

function asJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function asPlainText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return String(value);
  return value;
}

/**
 * Sanitize the user-supplied payload before INSERT. Throws (400) when `name`
 * is missing — we keep that as the single mandatory field so the user can
 * save half-empty drafts without friction.
 */
function normalizeDraftPayload(input = {}) {
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!rawName) {
    const err = new Error('Draft name is required');
    err.status = 400;
    throw err;
  }
  const slideCountNum = Number(input.slide_count);
  const slideCount = Number.isFinite(slideCountNum) ? slideCountNum : null;

  const versionNum = Number(input.pipeline_version);
  const pipelineVersion = versionNum === 1 ? 1 : 2;

  return {
    name: rawName.slice(0, 160),
    prompt: asPlainText(input.prompt),
    slide_count: slideCount,
    slide_prompts: asJson(input.slide_prompts),
    presentation_settings: asJson(input.presentation_settings),
    system_prompt: asPlainText(input.system_prompt),
    design_input: asJson(input.design_input),
    design_brief: asJson(input.design_brief),
    attachments: asJson(input.attachments),
    pipeline_version: pipelineVersion,
  };
}

function buildDraftInsertParams(userId, n) {
  // Order is contract-locked with INSERT_DRAFT_SQL below.
  return [
    userId,                     // $1 user_id
    n.name,                     // $2 name
    n.prompt,                   // $3 prompt
    n.slide_count,              // $4 slide_count
    n.slide_prompts,            // $5 slide_prompts
    n.presentation_settings,    // $6 presentation_settings
    n.system_prompt,            // $7 system_prompt
    n.design_input,             // $8 design_input
    n.design_brief,             // $9 design_brief
    n.attachments,              // $10 attachments
    n.pipeline_version,         // $11 pipeline_version
  ];
}

function buildVersionInsertParams(draftId, version, kind, n) {
  return [
    draftId,
    version,
    kind,
    null,                    // label
    n.prompt,
    n.slide_count,
    n.slide_prompts,
    n.presentation_settings,
    n.system_prompt,
    n.design_input,
    n.design_brief,
    n.attachments,
    n.pipeline_version,
  ];
}

function computeNextDraftVersion(rows) {
  let max = 0;
  for (const r of rows || []) {
    const v = Number(r.version);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max + 1;
}

const INSERT_DRAFT_SQL = `
  INSERT INTO presentator.job_drafts (
    user_id, name, prompt, slide_count, slide_prompts, presentation_settings,
    system_prompt, design_input, design_brief, attachments, pipeline_version,
    head_version
  ) VALUES (
    $1, $2, $3, $4, $5::jsonb, $6::jsonb,
    $7, $8::jsonb, $9::jsonb, $10::jsonb, $11,
    1
  )
  RETURNING id, name, prompt, slide_count, slide_prompts, presentation_settings,
            system_prompt, design_input, design_brief, attachments,
            pipeline_version, head_version, created_at, updated_at
`;

const INSERT_VERSION_SQL = `
  INSERT INTO presentator.job_draft_versions (
    draft_id, version, kind, label, prompt, slide_count, slide_prompts,
    presentation_settings, system_prompt, design_input, design_brief,
    attachments, pipeline_version
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7::jsonb,
    $8::jsonb, $9, $10::jsonb, $11::jsonb,
    $12::jsonb, $13
  )
  RETURNING id, version, kind, label, created_at
`;

async function createDraft({ userId, payload }, { query } = {}) {
  const n = normalizeDraftPayload(payload);
  const draftRes = await query(INSERT_DRAFT_SQL, buildDraftInsertParams(userId, n));
  const draft = draftRes.rows[0];
  await query(
    INSERT_VERSION_SQL,
    buildVersionInsertParams(draft.id, 1, 'initial', n),
  );
  return draft;
}

const SELECT_HEAD_VERSION_SQL = `
  SELECT head_version FROM presentator.job_drafts
   WHERE id = $1 AND user_id = $2
`;

const UPDATE_DRAFT_SQL = `
  UPDATE presentator.job_drafts SET
    name = $1,
    prompt = $2,
    slide_count = $3,
    slide_prompts = $4::jsonb,
    presentation_settings = $5::jsonb,
    system_prompt = $6,
    design_input = $7::jsonb,
    design_brief = $8::jsonb,
    attachments = $9::jsonb,
    pipeline_version = $10,
    head_version = $11,
    updated_at = now()
  WHERE id = $12 AND user_id = $13
  RETURNING id, name, prompt, slide_count, slide_prompts, presentation_settings,
            system_prompt, design_input, design_brief, attachments,
            pipeline_version, head_version, created_at, updated_at
`;

async function updateDraft({ userId, draftId, payload, kind = 'edit' }, { query } = {}) {
  const headRes = await query(SELECT_HEAD_VERSION_SQL, [draftId, userId]);
  if (!headRes.rows || headRes.rows.length === 0) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  const currentHead = Number(headRes.rows[0].head_version) || 0;
  const nextVersion = currentHead + 1;

  const n = normalizeDraftPayload(payload);

  const updRes = await query(UPDATE_DRAFT_SQL, [
    n.name,
    n.prompt,
    n.slide_count,
    n.slide_prompts,
    n.presentation_settings,
    n.system_prompt,
    n.design_input,
    n.design_brief,
    n.attachments,
    n.pipeline_version,
    nextVersion,
    draftId,
    userId,
  ]);

  await query(
    INSERT_VERSION_SQL,
    buildVersionInsertParams(draftId, nextVersion, kind, n),
  );

  return updRes.rows[0];
}

const LIST_DRAFTS_SQL = `
  SELECT id, name, prompt, slide_count, pipeline_version,
         head_version, created_at, updated_at
    FROM presentator.job_drafts
   WHERE user_id = $1
   ORDER BY updated_at DESC
`;

async function listDrafts(userId, { query } = {}) {
  const res = await query(LIST_DRAFTS_SQL, [userId]);
  return res.rows || [];
}

const GET_DRAFT_SQL = `
  SELECT id, name, prompt, slide_count, slide_prompts, presentation_settings,
         system_prompt, design_input, design_brief, attachments,
         pipeline_version, head_version, created_at, updated_at
    FROM presentator.job_drafts
   WHERE id = $1 AND user_id = $2
`;

async function getDraft(userId, draftId, { query } = {}) {
  const res = await query(GET_DRAFT_SQL, [draftId, userId]);
  return res.rows?.[0] || null;
}

const LIST_VERSIONS_SQL = `
  SELECT id, version, kind, label, created_at
    FROM presentator.job_draft_versions
   WHERE draft_id = $1
   ORDER BY version DESC
`;

async function listDraftVersions(userId, draftId, { query } = {}) {
  const owner = await query(
    `SELECT 1 FROM presentator.job_drafts WHERE id = $1 AND user_id = $2`,
    [draftId, userId],
  );
  if (!owner.rows || owner.rows.length === 0) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  const res = await query(LIST_VERSIONS_SQL, [draftId]);
  return res.rows || [];
}

const GET_VERSION_SQL = `
  SELECT id, draft_id, version, kind, prompt, slide_count, slide_prompts,
         presentation_settings, system_prompt, design_input, design_brief,
         attachments, pipeline_version
    FROM presentator.job_draft_versions
   WHERE draft_id = $1 AND version = $2
`;

async function restoreDraftVersion({ userId, draftId, version }, { query } = {}) {
  const verRes = await query(GET_VERSION_SQL, [draftId, version]);
  if (!verRes.rows || verRes.rows.length === 0) {
    const err = new Error('Draft version not found');
    err.status = 404;
    throw err;
  }
  const v = verRes.rows[0];
  const payload = {
    name: 'restored', // placeholder; normalizeDraftPayload requires non-empty; UPDATE keeps the existing name
    prompt: v.prompt,
    slide_count: v.slide_count,
    slide_prompts: v.slide_prompts,
    presentation_settings: v.presentation_settings,
    system_prompt: v.system_prompt,
    design_input: v.design_input,
    design_brief: v.design_brief,
    attachments: v.attachments,
    pipeline_version: v.pipeline_version,
  };

  // updateDraft path will bump head_version → newVersion. We need to preserve
  // the current name, so we read it from the parent and pass it through.
  const draft = await getDraft(userId, draftId, { query });
  if (!draft) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  payload.name = draft.name;

  const updated = await updateDraft(
    { userId, draftId, payload, kind: 'restore' },
    { query },
  );

  return {
    restoredFromVersion: Number(v.version),
    newVersion: Number(updated.head_version),
  };
}

async function deleteDraft(userId, draftId, { query } = {}) {
  const res = await query(
    `DELETE FROM presentator.job_drafts WHERE id = $1 AND user_id = $2 RETURNING id`,
    [draftId, userId],
  );
  if (!res.rows || res.rows.length === 0) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  return { id: res.rows[0].id };
}

module.exports = {
  normalizeDraftPayload,
  buildDraftInsertParams,
  buildVersionInsertParams,
  computeNextDraftVersion,
  createDraft,
  updateDraft,
  listDrafts,
  getDraft,
  listDraftVersions,
  restoreDraftVersion,
  deleteDraft,
};
