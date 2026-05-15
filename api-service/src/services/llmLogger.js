// LLM observability writer. One INSERT per logical LLM call (or per attempt of
// a staged pipeline step). Designed to be called from:
//   • PATCH /api/jobs/internal/:id/steps/:stage   (n8n callback, single call)
//   • PATCH /api/jobs/internal/:id                (legacy converter callback)
//   • services/pipeline.completeStage             (orchestration, fallback)
//
// The function is intentionally non-fatal: any failure is swallowed and
// reported to a logger. We never want a metrics write to break the actual
// pipeline callback.

const {
  estimateUsage,
  pickUsageFromResponse,
  mergeUsage,
  countTokens,
} = require('../utils/tokenizer');

/**
 * Pull a textual completion out of an OpenAI-compatible response. Handles:
 *   • message.content (string)
 *   • message.content (array of {type:'text', text:'...'})
 *   • message.reasoning_content as a fallback (some reasoning models leak
 *     the answer there when enable_thinking is still on)
 */
function extractTextFromResponse(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const choice = Array.isArray(raw.choices) ? raw.choices[0] : null;
  if (!choice || typeof choice !== 'object') return '';
  const msg = choice.message || {};

  const direct = msg.content;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  if (Array.isArray(direct)) {
    const joined = direct
      .map((p) => {
        if (!p || typeof p !== 'object') return '';
        if (typeof p.text === 'string') return p.text;
        if (typeof p.content === 'string') return p.content;
        return '';
      })
      .join('');
    if (joined.length > 0) return joined;
  }

  const reasoning =
    typeof msg.reasoning_content === 'string'
      ? msg.reasoning_content
      : typeof msg.reasoning === 'string'
        ? msg.reasoning
        : '';
  return reasoning || '';
}

/**
 * Convert raw call inputs/outputs into a normalized row ready for INSERT.
 * Pure: no DB calls, easy to unit-test.
 */
function buildLogRow({
  jobId,
  stepId = null,
  userId = null,
  stage,
  attempt = 1,
  model = null,
  provider = null,
  systemPrompt = null,
  userMessage = null,
  rawRequest = null,
  rawResponse = null,
  latencyMs = null,
  errorMessage = null,
}) {
  const responseText = extractTextFromResponse(rawResponse);

  const estimated = estimateUsage({
    systemPrompt,
    userMessage,
    // When the call errored, we don't count completion tokens — the bytes
    // returned are usually garbage (truncated JSON, reasoning leak, etc.)
    // and would distort the /metrics dashboard.
    responseText: errorMessage ? '' : responseText,
  });
  const providerUsage = errorMessage ? null : pickUsageFromResponse(rawResponse);
  const usage = mergeUsage({ provider: providerUsage, estimated });

  const finishReason =
    rawResponse &&
    typeof rawResponse === 'object' &&
    Array.isArray(rawResponse.choices)
      ? rawResponse.choices[0]?.finish_reason || null
      : null;

  return {
    job_id: jobId,
    step_id: stepId,
    user_id: userId,
    stage,
    attempt: Number.isFinite(Number(attempt)) ? Number(attempt) : 1,
    model,
    provider,
    system_prompt: systemPrompt || null,
    user_message: userMessage || null,
    raw_request: rawRequest || null,
    raw_response: rawResponse || null,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    tokens_source: usage.tokens_source,
    finish_reason: finishReason,
    latency_ms: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : null,
    error_message: errorMessage || null,
  };
}

const INSERT_SQL = `
  INSERT INTO presentator.llm_call_logs (
    job_id, step_id, user_id, stage, attempt, model, provider,
    system_prompt, user_message, raw_request, raw_response,
    prompt_tokens, completion_tokens, tokens_source,
    finish_reason, latency_ms, error_message
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10::jsonb, $11::jsonb,
    $12, $13, $14,
    $15, $16, $17
  )
  ON CONFLICT (step_id) WHERE step_id IS NOT NULL DO UPDATE SET
    raw_request = EXCLUDED.raw_request,
    raw_response = EXCLUDED.raw_response,
    prompt_tokens = EXCLUDED.prompt_tokens,
    completion_tokens = EXCLUDED.completion_tokens,
    tokens_source = EXCLUDED.tokens_source,
    finish_reason = EXCLUDED.finish_reason,
    latency_ms = EXCLUDED.latency_ms,
    error_message = EXCLUDED.error_message,
    model = COALESCE(EXCLUDED.model, presentator.llm_call_logs.model),
    user_message = EXCLUDED.user_message,
    system_prompt = EXCLUDED.system_prompt
  RETURNING id
`;

/**
 * Insert (or upsert by step_id) a row into llm_call_logs. Idempotent on
 * step_id so n8n retries don't double-count tokens.
 *
 * Non-fatal: returns null if the underlying query throws.
 *
 * @param {Object} input — same shape as buildLogRow's argument
 * @param {Object} deps
 * @param {Function} deps.query  — pg-style async function(sql, params)
 * @param {Function} [deps.logger] — defaults to console.error
 * @returns {Promise<string|null>} inserted row id
 */
async function insertLlmCallLog(input, { query, logger } = {}) {
  const log = logger || ((msg) => console.error(msg));
  if (typeof query !== 'function') {
    log('insertLlmCallLog: query is not a function');
    return null;
  }
  const row = buildLogRow(input);
  try {
    const result = await query(INSERT_SQL, [
      row.job_id,
      row.step_id,
      row.user_id,
      row.stage,
      row.attempt,
      row.model,
      row.provider,
      row.system_prompt,
      row.user_message,
      row.raw_request ? JSON.stringify(row.raw_request) : null,
      row.raw_response ? JSON.stringify(row.raw_response) : null,
      row.prompt_tokens,
      row.completion_tokens,
      row.tokens_source,
      row.finish_reason,
      row.latency_ms,
      row.error_message,
    ]);
    return result?.rows?.[0]?.id || null;
  } catch (err) {
    log(`insertLlmCallLog failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  buildLogRow,
  insertLlmCallLog,
  extractTextFromResponse,
  countTokens,
};
