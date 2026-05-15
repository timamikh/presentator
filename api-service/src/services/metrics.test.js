const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSummaryRow,
  buildByStageRows,
  buildByDayRows,
  buildByModelRows,
  parseDaysParam,
} = require('./metrics');

test('parseDaysParam clamps to a sane range', () => {
  assert.equal(parseDaysParam(undefined), 30);
  assert.equal(parseDaysParam('7'), 7);
  assert.equal(parseDaysParam('1'), 1);
  assert.equal(parseDaysParam('366'), 365);
  assert.equal(parseDaysParam('0'), 1);
  assert.equal(parseDaysParam('-1'), 1);
  assert.equal(parseDaysParam('abc'), 30);
});

test('buildSummaryRow normalizes nullable counters to zero', () => {
  const row = buildSummaryRow({
    total_calls: '5',
    total_prompt_tokens: null,
    total_completion_tokens: undefined,
    total_tokens: '',
    avg_latency_ms: '1234.7',
    total_jobs: 2,
    error_calls: '1',
  });
  assert.deepEqual(row, {
    total_calls: 5,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_tokens: 0,
    avg_latency_ms: 1235,
    total_jobs: 2,
    error_calls: 1,
  });
});

test('buildByStageRows projects raw rows to typed numbers', () => {
  const rows = buildByStageRows([
    { stage: 'planning', total_calls: '3', total_tokens: '120', avg_latency_ms: '900.5' },
    { stage: 'design', total_calls: '2', total_tokens: '80', avg_latency_ms: null },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stage, 'planning');
  assert.equal(rows[0].total_calls, 3);
  assert.equal(rows[0].total_tokens, 120);
  assert.equal(rows[0].avg_latency_ms, 901);
  assert.equal(rows[1].avg_latency_ms, 0);
});

test('buildByDayRows ensures stable ISO-date keys', () => {
  const rows = buildByDayRows([
    { day: '2026-05-12', total_calls: '4', total_tokens: '200' },
    { day: new Date('2026-05-13T00:00:00Z'), total_calls: '7', total_tokens: '350' },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(rows[1].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(rows[1].total_calls, 7);
  assert.equal(rows[1].total_tokens, 350);
});

test('buildByModelRows tolerates null model names', () => {
  const rows = buildByModelRows([
    { model: null, total_calls: '2', total_tokens: '50' },
    { model: 'qwen3', total_calls: '4', total_tokens: '120' },
  ]);
  assert.equal(rows[0].model, 'unknown');
  assert.equal(rows[1].model, 'qwen3');
});
