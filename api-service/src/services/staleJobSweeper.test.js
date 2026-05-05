const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STALE_JOB_STATUSES,
  STALE_STEP_STATUS,
  markStaleJobsAsError,
} = require('./staleJobSweeper');

test('STALE_JOB_STATUSES covers legacy + every staged processing_* status', () => {
  // Hotfix: previously the sweeper only matched 'processing'. New staged
  // pipeline parks jobs in status 'processing_planning' / '_design' /
  // '_layout' / '_refine' — all of these must time out as well, otherwise
  // a failed n8n execution leaves the spinner running forever.
  assert.deepEqual([...STALE_JOB_STATUSES].sort(), [
    'processing',
    'processing_design',
    'processing_layout',
    'processing_planning',
    'processing_refine',
  ]);
});

test('STALE_STEP_STATUS targets exactly running steps', () => {
  assert.equal(STALE_STEP_STATUS, 'running');
});

test('markStaleJobsAsError flips jobs to error and propagates to running steps', async () => {
  const calls = [];
  const fakeQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (/UPDATE\s+presentator\.jobs/i.test(sql)) {
      return { rowCount: 2, rows: [{ id: 'job-1' }, { id: 'job-2' }] };
    }
    return { rowCount: 3, rows: [] };
  };

  const result = await markStaleJobsAsError({
    query: fakeQuery,
    timeoutMinutes: 15,
  });

  assert.equal(result.staleJobIds.length, 2);
  assert.deepEqual(result.staleJobIds, ['job-1', 'job-2']);
  assert.equal(calls.length, 2);

  const jobUpdate = calls[0];
  assert.match(jobUpdate.sql, /UPDATE\s+presentator\.jobs/i);
  assert.match(jobUpdate.sql, /status\s*=\s*'error'/i);
  assert.match(jobUpdate.sql, /WHERE\s+status\s+IN\s*\(/i);
  for (const status of STALE_JOB_STATUSES) {
    assert.ok(
      jobUpdate.sql.includes(`'${status}'`),
      `expected ${status} in WHERE clause`,
    );
  }
  assert.ok(
    jobUpdate.params.some((p) => p === '15'),
    'timeoutMinutes must reach the query as a string parameter for the interval cast',
  );

  const stepUpdate = calls[1];
  assert.match(stepUpdate.sql, /UPDATE\s+presentator\.job_pipeline_steps/i);
  assert.match(stepUpdate.sql, /status\s*=\s*'error'/i);
  assert.match(stepUpdate.sql, /WHERE\s+status\s*=\s*'running'/i);
  assert.deepEqual(stepUpdate.params[1], ['job-1', 'job-2']);
});

test('markStaleJobsAsError is a no-op when nothing is stale', async () => {
  const calls = [];
  const fakeQuery = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 0, rows: [] };
  };

  const result = await markStaleJobsAsError({
    query: fakeQuery,
    timeoutMinutes: 5,
  });

  assert.deepEqual(result.staleJobIds, []);
  // Only the jobs UPDATE should run; we must not issue the steps UPDATE
  // when there are no stale jobs to avoid touching unrelated rows.
  assert.equal(calls.length, 1);
});

test('markStaleJobsAsError clamps timeout to a minimum of 1 minute', async () => {
  const calls = [];
  const fakeQuery = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 0, rows: [] };
  };

  await markStaleJobsAsError({ query: fakeQuery, timeoutMinutes: 0 });
  await markStaleJobsAsError({ query: fakeQuery, timeoutMinutes: -10 });

  for (const call of calls) {
    assert.ok(
      call.params.some((p) => p === '1'),
      'timeoutMinutes <= 0 must be clamped to 1',
    );
  }
});
