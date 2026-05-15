const test = require('node:test');
const assert = require('node:assert/strict');

const {
  countTokens,
  estimateUsage,
  pickUsageFromResponse,
  mergeUsage,
} = require('./tokenizer');

test('countTokens returns 0 for empty / falsy input', () => {
  assert.equal(countTokens(''), 0);
  assert.equal(countTokens(null), 0);
  assert.equal(countTokens(undefined), 0);
});

test('countTokens returns a positive int for non-trivial text', () => {
  const n = countTokens('Hello world, this is a tokenization test.');
  assert.equal(Number.isInteger(n), true);
  assert.ok(n > 0);
  assert.ok(n < 50);
});

test('countTokens stringifies non-string input deterministically', () => {
  const obj = { a: 1, b: [2, 3] };
  const direct = countTokens(JSON.stringify(obj));
  assert.equal(countTokens(obj), direct);
});

test('estimateUsage sums prompt + completion locally', () => {
  const u = estimateUsage({
    systemPrompt: 'You are an assistant.',
    userMessage: 'Hello there!',
    responseText: 'Hi! How can I help?',
  });
  assert.equal(Number.isInteger(u.prompt_tokens), true);
  assert.equal(Number.isInteger(u.completion_tokens), true);
  assert.equal(u.total_tokens, u.prompt_tokens + u.completion_tokens);
  assert.equal(u.tokens_source, 'estimated');
  assert.ok(u.prompt_tokens > 0);
  assert.ok(u.completion_tokens > 0);
});

test('estimateUsage tolerates missing fields', () => {
  const u = estimateUsage({});
  assert.equal(u.prompt_tokens, 0);
  assert.equal(u.completion_tokens, 0);
  assert.equal(u.total_tokens, 0);
  assert.equal(u.tokens_source, 'estimated');
});

test('pickUsageFromResponse extracts OpenAI-style usage object', () => {
  const raw = {
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
  const u = pickUsageFromResponse(raw);
  assert.deepEqual(u, {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30,
    tokens_source: 'provider',
  });
});

test('pickUsageFromResponse returns null when usage is missing or malformed', () => {
  assert.equal(pickUsageFromResponse({}), null);
  assert.equal(pickUsageFromResponse({ usage: null }), null);
  assert.equal(pickUsageFromResponse({ usage: 'oops' }), null);
  assert.equal(pickUsageFromResponse(null), null);
});

test('pickUsageFromResponse fills missing total_tokens from sum', () => {
  const u = pickUsageFromResponse({ usage: { prompt_tokens: 7, completion_tokens: 5 } });
  assert.equal(u.total_tokens, 12);
});

test('mergeUsage prefers provider numbers when both are present', () => {
  // We trust provider over local estimation for prompt+completion, but fall
  // back to local when either is missing/zero (some gateways return 0).
  const provider = {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    tokens_source: 'provider',
  };
  const estimated = {
    prompt_tokens: 110,
    completion_tokens: 60,
    total_tokens: 170,
    tokens_source: 'estimated',
  };
  const merged = mergeUsage({ provider, estimated });
  assert.equal(merged.prompt_tokens, 100);
  assert.equal(merged.completion_tokens, 50);
  assert.equal(merged.total_tokens, 150);
  assert.equal(merged.tokens_source, 'provider');
});

test('mergeUsage falls back to estimated when provider returns zero', () => {
  const provider = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    tokens_source: 'provider',
  };
  const estimated = {
    prompt_tokens: 80,
    completion_tokens: 40,
    total_tokens: 120,
    tokens_source: 'estimated',
  };
  const merged = mergeUsage({ provider, estimated });
  assert.equal(merged.prompt_tokens, 80);
  assert.equal(merged.completion_tokens, 40);
  assert.equal(merged.total_tokens, 120);
  assert.equal(merged.tokens_source, 'estimated');
});

test('mergeUsage marks mixed source when only one side is available from provider', () => {
  const provider = {
    prompt_tokens: 90,
    completion_tokens: 0,
    total_tokens: 90,
    tokens_source: 'provider',
  };
  const estimated = {
    prompt_tokens: 95,
    completion_tokens: 25,
    total_tokens: 120,
    tokens_source: 'estimated',
  };
  const merged = mergeUsage({ provider, estimated });
  assert.equal(merged.prompt_tokens, 90);
  assert.equal(merged.completion_tokens, 25);
  assert.equal(merged.tokens_source, 'mixed');
});

test('mergeUsage returns estimated when provider is null', () => {
  const estimated = {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    tokens_source: 'estimated',
  };
  const merged = mergeUsage({ provider: null, estimated });
  assert.deepEqual(merged, estimated);
});
