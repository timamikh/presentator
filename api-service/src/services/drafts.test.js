const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDraftPayload,
  buildDraftInsertParams,
  buildVersionInsertParams,
  computeNextDraftVersion,
} = require('./drafts');

test('normalizeDraftPayload coerces undefined fields to nulls and stringifies JSON', () => {
  const n = normalizeDraftPayload({
    name: '  My draft  ',
    prompt: 'Hello',
    slide_count: '5',
    slide_prompts: [{ idx: 0, text: 'a' }],
    presentation_settings: undefined,
    design_input: { tone: 'pro' },
    attachments: [{ attachmentId: 'a1' }],
    pipeline_version: 2,
  });
  assert.equal(n.name, 'My draft');
  assert.equal(n.prompt, 'Hello');
  assert.equal(n.slide_count, 5);
  assert.equal(n.slide_prompts, JSON.stringify([{ idx: 0, text: 'a' }]));
  assert.equal(n.presentation_settings, null);
  assert.equal(n.design_input, JSON.stringify({ tone: 'pro' }));
  assert.equal(n.attachments, JSON.stringify([{ attachmentId: 'a1' }]));
  assert.equal(n.pipeline_version, 2);
});

test('normalizeDraftPayload defaults pipeline_version to 2 and clamps slide_count', () => {
  const n = normalizeDraftPayload({ name: 'x', slide_count: 'not a number' });
  assert.equal(n.pipeline_version, 2);
  assert.equal(n.slide_count, null);
});

test('normalizeDraftPayload requires a non-empty name', () => {
  assert.throws(
    () => normalizeDraftPayload({ name: '   ' }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    },
  );
  assert.throws(
    () => normalizeDraftPayload({}),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test('computeNextDraftVersion returns max+1', () => {
  assert.equal(computeNextDraftVersion([]), 1);
  assert.equal(computeNextDraftVersion([{ version: 1 }, { version: 3 }]), 4);
});

test('buildDraftInsertParams produces 11 params in known order', () => {
  // [user_id, name, prompt, slide_count, slide_prompts, presentation_settings,
  //  system_prompt, design_input, design_brief, attachments, pipeline_version]
  const n = normalizeDraftPayload({ name: 'x', prompt: 'p' });
  const params = buildDraftInsertParams('u1', n);
  assert.equal(params.length, 11);
  assert.equal(params[0], 'u1');
  assert.equal(params[1], 'x');
  assert.equal(params[2], 'p');
  assert.equal(params[10], 2);
});

test('buildVersionInsertParams attaches draft_id and version', () => {
  const n = normalizeDraftPayload({ name: 'x', prompt: 'p' });
  const params = buildVersionInsertParams('d1', 4, 'edit', n);
  assert.equal(params[0], 'd1');
  assert.equal(params[1], 4);
  assert.equal(params[2], 'edit');
});

// ── Integration via injected query() ─────────────────────────────────

const {
  createDraft,
  updateDraft,
  listDrafts,
  getDraft,
  listDraftVersions,
  restoreDraftVersion,
  deleteDraft,
} = require('./drafts');

function makeFakeClient(scenarios) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    for (const s of scenarios) {
      if (s.match.test(sql)) {
        return typeof s.response === 'function' ? s.response(sql, params) : s.response;
      }
    }
    return { rows: [] };
  };
  return { query, calls };
}

test('createDraft inserts both draft and initial version', async () => {
  const fake = makeFakeClient([
    {
      match: /INSERT\s+INTO\s+presentator\.job_drafts\b/i,
      response: { rows: [{ id: 'd1', head_version: 1, name: 'x' }] },
    },
    {
      match: /INSERT\s+INTO\s+presentator\.job_draft_versions/i,
      response: { rows: [{ id: 'v1', version: 1 }] },
    },
  ]);
  const draft = await createDraft(
    { userId: 'u1', payload: { name: 'x', prompt: 'p' } },
    { query: fake.query },
  );
  assert.equal(draft.id, 'd1');
  assert.equal(fake.calls.length, 2);
});

test('updateDraft bumps head_version and inserts a new version row', async () => {
  const fake = makeFakeClient([
    {
      match: /SELECT\s+head_version\s+FROM presentator\.job_drafts/i,
      response: { rows: [{ head_version: 4 }] },
    },
    {
      match: /UPDATE\s+presentator\.job_drafts/i,
      response: {
        rowCount: 1,
        rows: [{ id: 'd1', head_version: 5 }],
      },
    },
    {
      match: /INSERT\s+INTO\s+presentator\.job_draft_versions/i,
      response: { rows: [{ id: 'v5', version: 5 }] },
    },
  ]);
  const result = await updateDraft(
    {
      userId: 'u1',
      draftId: 'd1',
      payload: { name: 'still x', prompt: 'updated' },
    },
    { query: fake.query },
  );
  assert.equal(result.head_version, 5);
  // Order matters: SELECT (current head) → UPDATE → INSERT version
  assert.match(fake.calls[0].sql, /SELECT\s+head_version/i);
  assert.match(fake.calls[1].sql, /UPDATE\s+presentator\.job_drafts/i);
  assert.match(fake.calls[2].sql, /INSERT\s+INTO\s+presentator\.job_draft_versions/i);
});

test('updateDraft throws 404 when draft is missing or not owned', async () => {
  const fake = makeFakeClient([
    {
      match: /SELECT\s+head_version\s+FROM presentator\.job_drafts/i,
      response: { rows: [] },
    },
  ]);
  await assert.rejects(
    () => updateDraft({ userId: 'u1', draftId: 'no', payload: { name: 'x' } }, { query: fake.query }),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('restoreDraftVersion copies a past version onto draft + writes restore row', async () => {
  const fake = makeFakeClient([
    {
      match: /FROM presentator\.job_draft_versions\s+WHERE\s+draft_id\s*=\s*\$1\s+AND\s+version/i,
      response: {
        rows: [
          {
            draft_id: 'd1',
            version: 2,
            prompt: 'old prompt',
            slide_count: 3,
            slide_prompts: null,
            presentation_settings: null,
            system_prompt: null,
            design_input: null,
            design_brief: null,
            attachments: null,
            pipeline_version: 2,
          },
        ],
      },
    },
    // getDraft re-read inside restoreDraftVersion (to preserve current name)
    {
      match: /FROM presentator\.job_drafts\s+WHERE\s+id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/i,
      response: {
        rows: [
          { id: 'd1', name: 'kept', head_version: 5 },
        ],
      },
    },
    {
      match: /SELECT\s+head_version\s+FROM presentator\.job_drafts/i,
      response: { rows: [{ head_version: 5 }] },
    },
    {
      match: /UPDATE\s+presentator\.job_drafts/i,
      response: { rowCount: 1, rows: [{ id: 'd1', head_version: 6 }] },
    },
    {
      match: /INSERT\s+INTO\s+presentator\.job_draft_versions/i,
      response: (sql, params) => {
        // kind must be 'restore' for audit
        assert.equal(params[2], 'restore');
        return { rows: [{ id: 'v6', version: params[1] }] };
      },
    },
  ]);
  const result = await restoreDraftVersion(
    { userId: 'u1', draftId: 'd1', version: 2 },
    { query: fake.query },
  );
  assert.equal(result.restoredFromVersion, 2);
  assert.equal(result.newVersion, 6);
});
