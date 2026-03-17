const { Router } = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = Router();

const DEFAULT_SYSTEM_PROMPT = `You are a presentation designer. You receive a user's request and must generate a structured JSON for a presentation.

Output ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "slides": [
    {
      "layout": "title|content|section|image|two_column",
      "title": "Slide title",
      "subtitle": "Optional subtitle (title layout only)",
      "body": ["Bullet 1", "Bullet 2"],
      "image": "/data/uploads/job_ID/filename.ext",
      "leftContent": ["Left col items"],
      "rightContent": ["Right col items"],
      "notes": "Speaker notes"
    }
  ],
  "theme": {
    "primaryColor": "#hex",
    "fontFamily": "Font Name"
  }
}

Rules:
- First slide should be "title" layout
- Use 5-10 slides for a typical presentation
- Body arrays should have 3-5 bullet points
- Only reference images from the provided file paths
- Make content professional and well-structured
- Respond in the same language as the user's prompt`;

async function getOrSeedSystemPrompt() {
  const selectResult = await query(
    'SELECT value FROM presentator.settings WHERE key = $1',
    ['default_system_prompt'],
  );

  if (selectResult.rows.length > 0) {
    return selectResult.rows[0].value;
  }

  await query(
    `INSERT INTO presentator.settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    ['default_system_prompt', DEFAULT_SYSTEM_PROMPT],
  );

  return DEFAULT_SYSTEM_PROMPT;
}

router.get('/system-prompt', authRequired, async (_req, res) => {
  try {
    const value = await getOrSeedSystemPrompt();
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

    await query(
      `INSERT INTO presentator.settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      ['default_system_prompt', value],
    );

    return res.json({ value });
  } catch (err) {
    console.error('Update system prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

