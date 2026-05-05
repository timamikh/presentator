// CRUD for user-saved design briefs.
// brief_json stores the structured form (palette, typography, layout, tone)
// as the frontend produces it. The aggregator (useDesignBriefAggregator) runs
// on the client at job-creation time and the resulting text prompt is included
// into Stage 2 (Design) via api-service → n8n.

const { Router } = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = Router();

const MAX_NAME_LENGTH = 120;
const MAX_BRIEF_BYTES = 32 * 1024;

function validateName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

function validateBrief(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_BRIEF_BYTES) return null;
  return raw;
}

router.get('/', authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, brief_json, created_at, updated_at
         FROM presentator.design_presets
        WHERE user_id = $1
        ORDER BY updated_at DESC`,
      [req.user.id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('List design presets error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const name = validateName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'name is required (1-120 chars)' });
    }
    const brief = validateBrief(req.body?.brief);
    if (brief === null) {
      return res.status(400).json({ error: 'brief must be a JSON object under 32KB' });
    }

    const result = await query(
      `INSERT INTO presentator.design_presets (user_id, name, brief_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO UPDATE
         SET brief_json = EXCLUDED.brief_json,
             updated_at = now()
       RETURNING id, name, brief_json, created_at, updated_at`,
      [req.user.id, name, JSON.stringify(brief || {})],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create design preset error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const sets = [];
    const params = [];
    let idx = 1;

    if (req.body?.name !== undefined) {
      const name = validateName(req.body.name);
      if (!name) {
        return res.status(400).json({ error: 'name must be a non-empty string up to 120 chars' });
      }
      sets.push(`name = $${idx++}`);
      params.push(name);
    }

    if (req.body?.brief !== undefined) {
      const brief = validateBrief(req.body.brief);
      if (brief === null) {
        return res.status(400).json({ error: 'brief must be a JSON object under 32KB' });
      }
      sets.push(`brief_json = $${idx++}`);
      params.push(JSON.stringify(brief || {}));
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    sets.push(`updated_at = now()`);
    params.push(req.params.id, req.user.id);

    const result = await query(
      `UPDATE presentator.design_presets
          SET ${sets.join(', ')}
        WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, name, brief_json, created_at, updated_at`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update design preset error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM presentator.design_presets
        WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete design preset error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
