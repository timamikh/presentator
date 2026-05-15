const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSnapshotInsertParams,
  buildAutoLabel,
  computeNextVersion,
  pickRestoreFields,
} = require('./snapshots');

// ── Pure helpers ──────────────────────────────────────────────────────

test('buildAutoLabel describes the stage and attempt', () => {
  assert.equal(buildAutoLabel({ stage: 'planning', attempt: 1 }), 'После планирования (попытка 1)');
  assert.equal(buildAutoLabel({ stage: 'design', attempt: 2 }), 'После дизайна (попытка 2)');
  assert.equal(buildAutoLabel({ stage: 'layout', attempt: 1 }), 'После верстки (попытка 1)');
  assert.equal(buildAutoLabel({ stage: 'refine_layout', attempt: 3 }), 'После доработки (попытка 3)');
  assert.equal(buildAutoLabel({ stage: 'unknown', attempt: 1 }), 'unknown (попытка 1)');
});

test('computeNextVersion returns max+1 from rows', () => {
  assert.equal(computeNextVersion([]), 1);
  assert.equal(computeNextVersion([{ version: 3 }]), 4);
  assert.equal(computeNextVersion([{ version: 1 }, { version: 5 }, { version: 2 }]), 6);
});

test('buildSnapshotInsertParams normalizes JSON fields and assigns version', () => {
  const params = buildSnapshotInsertParams({
    jobId: 'j1',
    version: 4,
    kind: 'auto',
    label: 'after planning',
    stage: 'planning',
    job: {
      status: 'awaiting_planning_review',
      current_stage: 'planning',
      prompt: 'p',
      slide_count: 5,
      slide_prompts: [{ a: 1 }],
      presentation_settings: { color: 'red' },
      system_prompt: 'sys',
      design_input: { tone: 'pro' },
      planning_result: { slides: [] },
      design_brief: null,
      slide_data: null,
      result_paths: { pdf: '/a.pdf' },
    },
    createdByStepId: 'step-1',
    createdByUserId: 'u1',
  });

  assert.equal(params.length, 19);
  // [job_id, version, kind, label, stage, status, current_stage, prompt,
  //  slide_count, slide_prompts, presentation_settings, system_prompt,
  //  design_input, planning_result, design_brief, slide_data, result_paths,
  //  step_id, user_id]
  // We keep it loose: spot-check the important values are present.
  assert.equal(params[0], 'j1');
  assert.equal(params[1], 4);
  assert.equal(params[2], 'auto');
  assert.equal(params[3], 'after planning');
  assert.equal(params[4], 'planning');
  assert.equal(params[5], 'awaiting_planning_review');
});

test('buildSnapshotInsertParams JSON-stringifies object/array fields and keeps nulls', () => {
  const params = buildSnapshotInsertParams({
    jobId: 'j2',
    version: 1,
    kind: 'manual',
    stage: null,
    job: {
      status: 'pending',
      current_stage: null,
      prompt: 'p',
      slide_count: 0,
      slide_prompts: null,
      presentation_settings: { x: 1 },
      system_prompt: null,
      design_input: null,
      planning_result: null,
      design_brief: null,
      slide_data: null,
      result_paths: null,
    },
  });
  // slide_prompts null → null, presentation_settings → JSON string
  // We assert the right "shape" by counting non-null JSON-ish strings.
  const jsonStrings = params.filter(
    (p) => typeof p === 'string' && (p.startsWith('{') || p.startsWith('[')),
  );
  assert.equal(jsonStrings.length, 1);
  assert.equal(jsonStrings[0], JSON.stringify({ x: 1 }));
});

test('pickRestoreFields exposes the right job columns and JSON-encodes them', () => {
  const snapshot = {
    prompt: 'p',
    slide_count: 7,
    slide_prompts: [{ idx: 0, text: 'hi' }],
    presentation_settings: { color: 'red' },
    system_prompt: null,
    design_input: { tone: 'pro' },
    planning_result: { slides: [{ title: 's1' }] },
    design_brief: { theme: 'x' },
    slide_data: { slides: [{ html: '<div/>' }] },
    status: 'awaiting_design_review',
    current_stage: 'design',
  };
  const { sets, params } = pickRestoreFields(snapshot);
  assert.ok(Array.isArray(sets));
  assert.ok(Array.isArray(params));
  assert.equal(sets.length, params.length);
  for (let i = 0; i < sets.length; i++) {
    assert.match(sets[i], /=\s*\$\d+(::jsonb)?$/, sets[i]);
  }
  // status / current_stage must always be included so the UI mood matches the
  // restored snapshot, otherwise the user lands back on the same broken step.
  assert.ok(sets.some((s) => /^status\s*=/.test(s)));
  assert.ok(sets.some((s) => /^current_stage\s*=/.test(s)));
});

// ── Integration via injected query() ─────────────────────────────────

const {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
} = require('./snapshots');

function makeFakeClient(scenarios) {
  // scenarios is an array of {match: RegExp, response: Object|Function}
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

test('createSnapshot inserts with computed version=max+1', async () => {
  const fake = makeFakeClient([
    {
      match: /FROM presentator\.jobs/i,
      response: {
        rows: [
          {
            id: 'j1',
            status: 'awaiting_planning_review',
            current_stage: 'planning',
            prompt: 'p',
            slide_count: 3,
            slide_prompts: [],
            presentation_settings: {},
            system_prompt: null,
            design_input: null,
            planning_result: { slides: [] },
            design_brief: null,
            slide_data: null,
            result_paths: null,
          },
        ],
      },
    },
    {
      match: /SELECT\s+COALESCE\(MAX\(version\)/i,
      response: { rows: [{ next_version: 5 }] },
    },
    {
      match: /INSERT\s+INTO\s+presentator\.job_snapshots/i,
      response: { rows: [{ id: 'snap-1', version: 5 }] },
    },
  ]);

  const result = await createSnapshot(
    { jobId: 'j1', kind: 'auto', stage: 'planning', attempt: 1 },
    { query: fake.query },
  );

  assert.equal(result.id, 'snap-1');
  assert.equal(result.version, 5);
  // We expect: SELECT job, SELECT next_version, INSERT snapshot
  assert.equal(fake.calls.length, 3);
  assert.match(fake.calls[2].sql, /INSERT\s+INTO\s+presentator\.job_snapshots/i);
});

test('createSnapshot throws 404 when job is missing', async () => {
  const fake = makeFakeClient([
    { match: /FROM presentator\.jobs/i, response: { rows: [] } },
  ]);
  await assert.rejects(
    () => createSnapshot({ jobId: 'no', kind: 'manual' }, { query: fake.query }),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('listSnapshots returns rows in descending version order', async () => {
  const fake = makeFakeClient([
    {
      match: /FROM presentator\.job_snapshots/i,
      response: {
        rows: [
          { id: 'a', version: 3 },
          { id: 'b', version: 2 },
          { id: 'c', version: 1 },
        ],
      },
    },
  ]);
  const rows = await listSnapshots('j1', { query: fake.query });
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.version),
    [3, 2, 1],
  );
  assert.match(fake.calls[0].sql, /ORDER BY version DESC/i);
});

test('restoreSnapshot applies snapshot fields and writes a new "restore" row', async () => {
  const snapshot = {
    id: 'snap-2',
    version: 2,
    job_id: 'j1',
    prompt: 'p',
    slide_count: 4,
    slide_prompts: [],
    presentation_settings: {},
    system_prompt: 'sys',
    design_input: { a: 1 },
    planning_result: { slides: [] },
    design_brief: null,
    slide_data: null,
    status: 'awaiting_design_review',
    current_stage: 'design',
  };

  let updated = false;
  let insertedVersion = null;

  // Order matters: more specific selects (with version filter) come before the
  // generic "FROM presentator.jobs" SELECT used by re-read after UPDATE.
  const fake = makeFakeClient([
    {
      match: /FROM presentator\.job_snapshots\s+WHERE\s+job_id\s*=\s*\$1\s+AND\s+version/i,
      response: { rows: [snapshot] },
    },
    {
      match: /FROM presentator\.jobs/i,
      response: {
        rows: [
          {
            id: 'j1',
            status: 'awaiting_design_review',
            current_stage: 'design',
            prompt: 'p',
            slide_count: 4,
            slide_prompts: [],
            presentation_settings: {},
            system_prompt: 'sys',
            design_input: { a: 1 },
            planning_result: { slides: [] },
            design_brief: null,
            slide_data: null,
            result_paths: null,
          },
        ],
      },
    },
    {
      match: /UPDATE\s+presentator\.jobs/i,
      response: (sql) => {
        updated = true;
        // Must contain the key restored columns:
        assert.match(sql, /design_input\s*=/i);
        assert.match(sql, /status\s*=/i);
        return { rowCount: 1, rows: [] };
      },
    },
    {
      match: /SELECT\s+COALESCE\(MAX\(version\)/i,
      response: { rows: [{ next_version: 7 }] },
    },
    {
      match: /INSERT\s+INTO\s+presentator\.job_snapshots/i,
      response: (sql, params) => {
        // params[1] is version, params[2] is kind
        insertedVersion = params[1];
        assert.equal(params[2], 'restore');
        return { rows: [{ id: 'snap-3', version: params[1] }] };
      },
    },
  ]);

  const result = await restoreSnapshot(
    { jobId: 'j1', version: 2, userId: 'u1' },
    { query: fake.query },
  );

  assert.equal(updated, true);
  assert.equal(insertedVersion, 7);
  assert.equal(result.restoredFromVersion, 2);
  assert.equal(result.newVersion, 7);
});
