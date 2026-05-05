const { Router } = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');
const {
  PROMPT_KEYS,
  DEFAULT_PROMPTS,
  isPromptKey,
} = require('../utils/promptDefaults');

const router = Router();

// Look up the prompt by key, seeding the DB row from DEFAULT_PROMPTS the first
// time it is requested. This keeps settings/* endpoints idempotent and allows
// the workflow / frontend to rely on a guaranteed value.
async function getOrSeedPrompt(key) {
  if (!isPromptKey(key)) {
    throw Object.assign(new Error('Unknown prompt key'), { status: 400 });
  }

  const selectResult = await query(
    'SELECT value FROM presentator.settings WHERE key = $1',
    [key],
  );

  if (selectResult.rows.length > 0) {
    return selectResult.rows[0].value;
  }

  const seed = DEFAULT_PROMPTS[key] || '';
  await query(
    `INSERT INTO presentator.settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, seed],
  );

  return seed;
}

async function setPrompt(key, value) {
  if (!isPromptKey(key)) {
    throw Object.assign(new Error('Unknown prompt key'), { status: 400 });
  }

  await query(
    `INSERT INTO presentator.settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

// ── New: stage-aware prompts API ─────────────────────────────────────

router.get('/prompts', authRequired, async (_req, res) => {
  try {
    const out = {};
    for (const key of PROMPT_KEYS) {
      out[key] = await getOrSeedPrompt(key);
    }
    return res.json(out);
  } catch (err) {
    console.error('Get prompts error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/prompts/:key', authRequired, async (req, res) => {
  try {
    const key = req.params.key;
    if (!isPromptKey(key)) {
      return res.status(400).json({ error: `Unknown prompt key: ${key}` });
    }
    const value = await getOrSeedPrompt(key);
    return res.json({ key, value });
  } catch (err) {
    console.error('Get prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/prompts/:key', authRequired, async (req, res) => {
  try {
    const key = req.params.key;
    if (!isPromptKey(key)) {
      return res.status(400).json({ error: `Unknown prompt key: ${key}` });
    }
    const { value } = req.body;
    if (typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'value is required' });
    }
    await setPrompt(key, value);
    return res.json({ key, value });
  } catch (err) {
    console.error('Update prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/prompts/:key/reset', authRequired, async (req, res) => {
  try {
    const key = req.params.key;
    if (!isPromptKey(key)) {
      return res.status(400).json({ error: `Unknown prompt key: ${key}` });
    }
    await setPrompt(key, DEFAULT_PROMPTS[key]);
    return res.json({ key, value: DEFAULT_PROMPTS[key] });
  } catch (err) {
    console.error('Reset prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Legacy: single system-prompt endpoint (deprecated) ───────────────
// Kept for backwards compatibility with pipeline_version=1 jobs and the old
// single-modal frontend. Maps to default_layout_prompt under the hood.

router.get('/system-prompt', authRequired, async (_req, res) => {
  try {
    const value = await getOrSeedPrompt('default_layout_prompt');
    return res.json({ value });
  } catch (err) {
    console.error('Get system prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/system-prompt', authRequired, async (req, res) => {
  try {
    const { value } = req.body;
    if (!value || typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'System prompt value is required' });
    }
    await setPrompt('default_layout_prompt', value);
    return res.json({ value });
  } catch (err) {
    console.error('Update system prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.getOrSeedPrompt = getOrSeedPrompt;
module.exports.setPrompt = setPrompt;
