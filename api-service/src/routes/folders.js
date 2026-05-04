const { Router } = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = Router();

const MAX_NAME_LENGTH = 255;
const FORBIDDEN_NAME_CHARS = /[\\/]/;

function normalizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH || FORBIDDEN_NAME_CHARS.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeParentId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  return raw;
}

async function ensureFolderOwned(userId, folderId) {
  if (!folderId) return null;
  const result = await query(
    `SELECT id, parent_folder_id FROM presentator.folders
     WHERE id = $1 AND user_id = $2`,
    [folderId, userId],
  );
  return result.rows[0] || null;
}

// Walks up the parent chain to detect cycles when moving a folder.
async function wouldCreateCycle(userId, folderId, candidateParentId) {
  if (!candidateParentId) return false;
  if (folderId === candidateParentId) return true;

  let cursor = candidateParentId;
  const guard = new Set();
  while (cursor) {
    if (guard.has(cursor)) return true;
    guard.add(cursor);
    if (cursor === folderId) return true;

    const result = await query(
      `SELECT parent_folder_id FROM presentator.folders
       WHERE id = $1 AND user_id = $2`,
      [cursor, userId],
    );
    if (result.rows.length === 0) return false;
    cursor = result.rows[0].parent_folder_id;
  }
  return false;
}

// GET /api/folders — full tree of the user (flat list with parent_folder_id).
// The frontend builds the tree client-side; for the expected scale this is cheap.
router.get('/', authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, parent_folder_id, name, created_at, updated_at
       FROM presentator.folders
       WHERE user_id = $1
       ORDER BY parent_folder_id NULLS FIRST, name`,
      [req.user.id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('List folders error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const name = normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required (1-255 chars, no slashes)' });
    }

    const parentId = normalizeParentId(req.body?.parentId);
    if (parentId === undefined) {
      return res.status(400).json({ error: 'parentId must be a UUID string or null' });
    }

    if (parentId) {
      const parent = await ensureFolderOwned(req.user.id, parentId);
      if (!parent) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
    }

    try {
      const result = await query(
        `INSERT INTO presentator.folders (user_id, parent_folder_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, parent_folder_id, name, created_at, updated_at`,
        [req.user.id, parentId, name],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Folder with this name already exists at this level' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Create folder error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const folder = await ensureFolderOwned(req.user.id, req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (req.body?.name !== undefined) {
      const name = normalizeName(req.body.name);
      if (!name) {
        return res.status(400).json({ error: 'Invalid folder name' });
      }
      sets.push(`name = $${idx++}`);
      params.push(name);
    }

    if (req.body?.parentId !== undefined) {
      const parentId = normalizeParentId(req.body.parentId);
      if (parentId === undefined) {
        return res.status(400).json({ error: 'parentId must be a UUID string or null' });
      }
      if (parentId) {
        const parent = await ensureFolderOwned(req.user.id, parentId);
        if (!parent) {
          return res.status(404).json({ error: 'Parent folder not found' });
        }
        if (await wouldCreateCycle(req.user.id, req.params.id, parentId)) {
          return res.status(400).json({ error: 'Cannot move folder into its own descendant' });
        }
      }
      sets.push(`parent_folder_id = $${idx++}`);
      params.push(parentId);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    sets.push(`updated_at = now()`);
    params.push(req.params.id, req.user.id);

    try {
      const result = await query(
        `UPDATE presentator.folders
         SET ${sets.join(', ')}
         WHERE id = $${idx++} AND user_id = $${idx}
         RETURNING id, parent_folder_id, name, created_at, updated_at`,
        params,
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Folder with this name already exists at the target level' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Update folder error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/folders/:id — by default refuses if folder contains children
// (subfolders or attachments) to prevent accidental data loss.
// Pass ?force=true to cascade subfolders and orphan attachments to the root.
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const folder = await ensureFolderOwned(req.user.id, req.params.id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const force = req.query.force === 'true' || req.query.force === '1';

    if (!force) {
      const children = await query(
        `SELECT
           (SELECT COUNT(*)::int FROM presentator.folders WHERE parent_folder_id = $1) AS sub_count,
           (SELECT COUNT(*)::int FROM presentator.attachments WHERE folder_id = $1) AS att_count`,
        [req.params.id],
      );
      const { sub_count, att_count } = children.rows[0];
      if (sub_count > 0 || att_count > 0) {
        return res.status(409).json({
          error: 'Folder is not empty',
          subfolders: sub_count,
          attachments: att_count,
        });
      }
    }

    await query(
      `DELETE FROM presentator.folders WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete folder error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
