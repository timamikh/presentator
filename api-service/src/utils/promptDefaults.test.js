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

test('every default prompt is a non-empty string of meaningful length', () => {
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
  assert.match(DEFAULT_PROMPTS.default_design_prompt, /Не пиши HTML|do not write HTML/i);
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

// ── Source-of-truth invariants for the <DOCUMENTS> block ─────────────
//
// The n8n build-*-prompt nodes now inject a <DOCUMENTS> block (built from
// attachments[*].content) into every stage's user-message. Each system
// prompt MUST teach the model how to handle that block, otherwise the LLM
// either ignores it or summarizes it away (the exact regression that made
// schedules and tables vanish from generated presentations).

test('every default prompt explains how to use the <DOCUMENTS> block', () => {
  for (const k of PROMPT_KEYS) {
    assert.match(
      DEFAULT_PROMPTS[k],
      /<DOCUMENTS>/,
      `prompt ${k} must mention the <DOCUMENTS> block`,
    );
  }
});

test('planning prompt forbids summarizing structured data away', () => {
  // Lists / dates / agendas / tables / schedules — the model must reuse
  // them verbatim, not paraphrase. Russian wording is mandatory because
  // the planning prompt is русско­язычный.
  const p = DEFAULT_PROMPTS.default_planning_prompt;
  assert.match(p, /списк/i, 'must reference списки');
  assert.match(p, /дат|расписан|табли/i, 'must reference dates/schedules/tables');
  // Must explicitly forbid invention/hallucination.
  assert.match(p, /не выдумыв|не сочин|не придумыв/i);
});

test('design prompt acknowledges <DOCUMENTS> as context for visual choices', () => {
  const p = DEFAULT_PROMPTS.default_design_prompt;
  assert.match(p, /<DOCUMENTS>/);
  // Design should pick layouts (table for schedule, cards for list of names, etc.)
  // and must not fabricate content that's not in planning_result.
  assert.match(p, /planning_result/i);
});

test('layout prompt must base content strictly on planning_result, not invent', () => {
  const p = DEFAULT_PROMPTS.default_layout_prompt;
  assert.match(p, /planning_result/i);
  // English wording is fine — the layout prompt is English by design.
  assert.match(p, /do not (invent|fabricate|hallucinate)|не выдумыв/i);
});

test('refine prompt mentions <DOCUMENTS> so refinements can cite the originals', () => {
  const p = DEFAULT_PROMPTS.default_refine_prompt;
  assert.match(p, /<DOCUMENTS>/);
});

test('every prompt forbids hallucinated facts when documents are provided', () => {
  // Catch-all sanity check: each prompt should contain at least one phrase
  // that tells the model "use the provided documents as the source of truth".
  for (const k of PROMPT_KEYS) {
    assert.match(
      DEFAULT_PROMPTS[k],
      /source of truth|первичный источник|основной источник|основан\w* на/i,
      `prompt ${k} should declare DOCUMENTS as the source of truth`,
    );
  }
});
