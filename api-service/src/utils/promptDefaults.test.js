const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROMPTS,
  PROMPT_KEYS,
  isPromptKey,
} = require('./promptDefaults');

test('PROMPT_KEYS contains exactly the four staged-pipeline keys', () => {
  assert.deepEqual(PROMPT_KEYS.sort(), [
    'default_design_prompt',
    'default_layout_prompt',
    'default_planning_prompt',
    'default_refine_prompt',
  ]);
});

test('isPromptKey accepts known keys and rejects others', () => {
  for (const k of PROMPT_KEYS) {
    assert.equal(isPromptKey(k), true);
  }
  assert.equal(isPromptKey('default_unknown'), false);
  assert.equal(isPromptKey(''), false);
  assert.equal(isPromptKey(null), false);
  assert.equal(isPromptKey(42), false);
});

test('every default prompt is a non-empty string', () => {
  for (const k of PROMPT_KEYS) {
    assert.equal(typeof DEFAULT_PROMPTS[k], 'string');
    assert.ok(DEFAULT_PROMPTS[k].trim().length > 100, `prompt ${k} too short`);
  }
});

test('layout prompt mentions slide framework variables', () => {
  assert.match(DEFAULT_PROMPTS.default_layout_prompt, /--primary/);
  assert.match(DEFAULT_PROMPTS.default_layout_prompt, /\.heading-xl/);
});

test('planning prompt forbids HTML/CSS', () => {
  assert.match(DEFAULT_PROMPTS.default_planning_prompt, /HTML\/CSS|HTML/);
});

test('design prompt forbids writing HTML', () => {
  assert.match(DEFAULT_PROMPTS.default_design_prompt, /Не пиши HTML/);
});

test('refine prompt requires preserving placeholders', () => {
  assert.match(
    DEFAULT_PROMPTS.default_refine_prompt,
    /\{\{attachment:<ref>\}\}/,
  );
});

// Hot-fix coverage: planning + design must explicitly forbid reasoning-style
// preambles ("Here's a thinking process", "Let me analyze...", etc.) and
// require RAW-JSON-only output. This is what unblocks reasoning models like
// Qwen3 thinking variants when enable_thinking=false isn't honored.
test('planning prompt forbids reasoning-style preambles and demands raw JSON', () => {
  const p = DEFAULT_PROMPTS.default_planning_prompt;
  assert.match(p, /RAW JSON/);
  assert.match(p, /thinking process|размышл|thinking/i);
  assert.match(p, /enable_thinking|выключ/i);
});

test('design prompt forbids reasoning-style preambles and demands raw JSON', () => {
  const p = DEFAULT_PROMPTS.default_design_prompt;
  assert.match(p, /RAW JSON/);
  assert.match(p, /thinking process|размышл|thinking/i);
  assert.match(p, /enable_thinking|выключ/i);
});
