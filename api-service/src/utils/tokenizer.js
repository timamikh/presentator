// Local token estimation. The project uses an OpenAI-compatible gateway whose
// `usage` reporting is unreliable (some models return zeros, others omit the
// field). To get consistent per-stage numbers for the /metrics dashboard we
// always count locally with gpt-tokenizer (cl100k_base). When the provider DOES
// return a usable usage block we still prefer it via mergeUsage() — that gives
// us provider-accurate numbers when available and a graceful local fallback
// when not.

const tokenizer = require('gpt-tokenizer');

function asTextInput(input) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * Returns the number of cl100k_base tokens in the input. Non-string inputs
 * are JSON-stringified first so callers can pass raw objects (e.g. payloads)
 * without manual serialization.
 *
 * @param {unknown} input
 * @returns {number}
 */
function countTokens(input) {
  const text = asTextInput(input);
  if (!text) return 0;
  try {
    return tokenizer.encode(text).length;
  } catch (err) {
    // Fall back to a 4-char-per-token approximation if encoding ever throws.
    // This keeps the analytics pipeline non-fatal — we'd rather log an
    // approximate number than crash a callback.
    return Math.ceil(text.length / 4);
  }
}

/**
 * Counts prompt / completion tokens locally and returns a structured usage
 * object compatible with mergeUsage().
 *
 * @param {Object} args
 * @param {string} [args.systemPrompt]
 * @param {string} [args.userMessage]
 * @param {string|Object} [args.responseText]  raw textual content from the LLM
 *                                             (object → JSON-stringified)
 * @returns {{prompt_tokens:number, completion_tokens:number,
 *           total_tokens:number, tokens_source:'estimated'}}
 */
function estimateUsage({ systemPrompt, userMessage, responseText } = {}) {
  const prompt = countTokens(systemPrompt) + countTokens(userMessage);
  const completion = countTokens(responseText);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    tokens_source: 'estimated',
  };
}

/**
 * Extracts the OpenAI-compatible `usage` block from a raw LLM response.
 * Returns null if the field is missing or not an object.
 *
 * @param {*} raw
 * @returns {{prompt_tokens:number, completion_tokens:number,
 *            total_tokens:number, tokens_source:'provider'}|null}
 */
function pickUsageFromResponse(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw.usage;
  if (!usage || typeof usage !== 'object') return null;

  const prompt = Number(usage.prompt_tokens);
  const completion = Number(usage.completion_tokens);
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return null;

  const promptN = Number.isFinite(prompt) ? prompt : 0;
  const completionN = Number.isFinite(completion) ? completion : 0;
  const total = Number.isFinite(Number(usage.total_tokens))
    ? Number(usage.total_tokens)
    : promptN + completionN;

  return {
    prompt_tokens: promptN,
    completion_tokens: completionN,
    total_tokens: total,
    tokens_source: 'provider',
  };
}

/**
 * Combines provider-reported usage with locally-estimated usage. Provider wins
 * unless it returned 0 (some gateways do that, which would silently zero out
 * the metrics page). Mixed sources are tagged 'mixed' so the UI can show that.
 *
 * @param {Object} args
 * @param {Object|null} args.provider — output of pickUsageFromResponse, or null
 * @param {Object}      args.estimated — output of estimateUsage
 * @returns {{prompt_tokens:number, completion_tokens:number,
 *            total_tokens:number, tokens_source:'provider'|'estimated'|'mixed'}}
 */
function mergeUsage({ provider, estimated }) {
  if (!provider) return { ...estimated };

  const providerPrompt = Number(provider.prompt_tokens) || 0;
  const providerCompletion = Number(provider.completion_tokens) || 0;

  const usePromptProvider = providerPrompt > 0;
  const useCompletionProvider = providerCompletion > 0;

  const prompt = usePromptProvider ? providerPrompt : estimated.prompt_tokens;
  const completion = useCompletionProvider
    ? providerCompletion
    : estimated.completion_tokens;

  let source;
  if (usePromptProvider && useCompletionProvider) source = 'provider';
  else if (!usePromptProvider && !useCompletionProvider) source = 'estimated';
  else source = 'mixed';

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    tokens_source: source,
  };
}

module.exports = {
  countTokens,
  estimateUsage,
  pickUsageFromResponse,
  mergeUsage,
};
