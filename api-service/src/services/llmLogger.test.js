const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLogRow,
  insertLlmCallLog,
  extractTextFromResponse,
} = require('./llmLogger');

test('extractTextFromResponse picks message.content first', () => {
  const text = extractTextFromResponse({
    choices: [{ message: { content: 'hello', reasoning_content: 'think' } }],
  });
  assert.equal(text, 'hello');
});

test('extractTextFromResponse falls back to reasoning_content when content is empty', () => {
  // Some reasoning models leak the answer into reasoning_content when
  // enable_thinking is on. We still want to count those tokens.
  const text = extractTextFromResponse({
    choices: [{ message: { content: '', reasoning_content: 'fallback' } }],
  });
  assert.equal(text, 'fallback');
});

test('extractTextFromResponse handles a stringified content array', () => {
  // Some gateways return content as [{type:'text', text:'...'}, ...].
  const text = extractTextFromResponse({
    choices: [
      {
        message: {
          content: [
            { type: 'text', text: 'part1 ' },
            { type: 'text', text: 'part2' },
          ],
        },
      },
    ],
  });
  assert.equal(text, 'part1 part2');
});

test('extractTextFromResponse returns empty string for malformed input', () => {
  assert.equal(extractTextFromResponse(null), '');
  assert.equal(extractTextFromResponse({}), '');
  assert.equal(extractTextFromResponse({ choices: [] }), '');
});

test('buildLogRow computes local tokens and prefers provider usage when present', () => {
  const row = buildLogRow({
    jobId: 'j1',
    stepId: 's1',
    userId: 'u1',
    stage: 'planning',
    attempt: 1,
    model: 'qwen3-30b',
    provider: 'https://api.example/v1',
    systemPrompt: 'You are an assistant.',
    userMessage: 'Plan 3 slides.',
    rawRequest: { messages: [] },
    rawResponse: {
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 25, completion_tokens: 7, total_tokens: 32 },
    },
    latencyMs: 1234,
  });

  assert.equal(row.job_id, 'j1');
  assert.equal(row.step_id, 's1');
  assert.equal(row.user_id, 'u1');
  assert.equal(row.stage, 'planning');
  assert.equal(row.attempt, 1);
  assert.equal(row.model, 'qwen3-30b');
  assert.equal(row.finish_reason, 'stop');
  assert.equal(row.latency_ms, 1234);
  assert.equal(row.tokens_source, 'provider');
  assert.equal(row.prompt_tokens, 25);
  assert.equal(row.completion_tokens, 7);
  assert.equal(row.error_message, null);
});

test('buildLogRow falls back to local estimation when provider usage is missing', () => {
  const row = buildLogRow({
    jobId: 'j1',
    stage: 'design',
    systemPrompt: 'sys',
    userMessage: 'hello world',
    rawResponse: { choices: [{ message: { content: 'answer here' } }] },
  });
  assert.equal(row.tokens_source, 'estimated');
  assert.ok(row.prompt_tokens > 0);
  assert.ok(row.completion_tokens > 0);
});

test('buildLogRow captures errorMessage and zeroes completion tokens on error', () => {
  // When n8n's Parse-* node reports a parsing error, we still want a log row
  // with the raw response visible — but the completion didn't really happen,
  // so we don't count completion_tokens for it.
  const row = buildLogRow({
    jobId: 'j1',
    stage: 'layout',
    systemPrompt: 'sys',
    userMessage: 'user',
    rawResponse: { choices: [{ message: { content: 'garbage' } }] },
    errorMessage: 'JSON parse failed',
  });
  assert.equal(row.error_message, 'JSON parse failed');
  assert.ok(row.prompt_tokens > 0);
  assert.equal(row.completion_tokens, 0);
});

test('insertLlmCallLog calls query with the right SQL and params', async () => {
  const calls = [];
  const fakeQuery = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'log-1' }] };
  };

  const id = await insertLlmCallLog(
    {
      jobId: 'j1',
      stepId: 's1',
      stage: 'planning',
      attempt: 1,
      model: 'qwen3',
      systemPrompt: 'sys',
      userMessage: 'user',
      rawResponse: { choices: [{ message: { content: 'ok' } }] },
    },
    { query: fakeQuery },
  );

  assert.equal(id, 'log-1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT\s+INTO\s+presentator\.llm_call_logs/i);
  // The ON CONFLICT clause is what makes this idempotent on step_id; without
  // it n8n retries would duplicate rows and skew /metrics totals.
  // Postgres requires the partial-index predicate to be repeated in the
  // ON CONFLICT clause — without it the INSERT fails with
  // "no unique or exclusion constraint matching the ON CONFLICT specification".
  assert.match(
    calls[0].sql,
    /ON\s+CONFLICT\s*\(step_id\)\s+WHERE\s+step_id\s+IS\s+NOT\s+NULL/i,
  );
});

test('insertLlmCallLog returns null when query throws (must not crash callback)', async () => {
  const fakeQuery = async () => { throw new Error('db down'); };
  const id = await insertLlmCallLog(
    { jobId: 'j1', stage: 'planning' },
    { query: fakeQuery, logger: () => {} },
  );
  assert.equal(id, null);
});
