const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const LIBRARY_DIR = path.join('/data', 'library');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeBaseName(originalName) {
  const base = path.basename(originalName || 'file');
  return base.replace(/[^\w.\-() ]+/g, '_');
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userDir = path.join(LIBRARY_DIR, req.user.id);
    ensureDir(userDir);
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const name = safeBaseName(file.originalname);
    cb(null, `${uuidv4()}_${name}`);
  },
});

const upload = multer({ storage, limits: { files: 1 } });

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const { q, type } = req.query;
    const clauses = ['a.user_id = $1'];
    const params = [req.user.id];
    let idx = 2;

    if (q && String(q).trim()) {
      clauses.push(`a.original_name ILIKE $${idx++}`);
      params.push(`%${String(q).trim()}%`);
    }
    if (type && String(type).trim()) {
      clauses.push(`a.mime_type ILIKE $${idx++}`);
      params.push(`${String(type).trim()}%`);
    }

    const result = await query(
      `SELECT
         a.id,
         a.original_name,
         a.mime_type,
         a.file_size,
         a.prompt,
         a.created_at,
         a.updated_at,
         COALESCE(COUNT(DISTINCT ja.job_id), 0)::int AS used_in_jobs
       FROM presentator.attachments a
       LEFT JOIN presentator.job_attachments ja ON ja.attachment_id = a.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY a.id
       ORDER BY a.created_at DESC`,
      params,
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('List attachments error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    const insert = await query(
      `INSERT INTO presentator.attachments (
         user_id,
         original_name,
         file_path,
         mime_type,
         file_size,
         prompt,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       RETURNING id, original_name, mime_type, file_size, prompt, created_at, updated_at`,
      [
        req.user.id,
        req.file.originalname,
        req.file.path,
        req.file.mimetype || null,
        Number.isFinite(Number(req.file.size)) ? Number(req.file.size) : null,
        prompt || null,
      ],
    );

    return res.status(201).json(insert.rows[0]);
  } catch (err) {
    console.error('Create attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const { value } = req.body;
    if (value !== null && value !== undefined && typeof value !== 'string') {
      return res.status(400).json({ error: 'Prompt must be a string or null' });
    }

    const newPrompt = typeof value === 'string' ? value.trim() : null;

    const result = await query(
      `UPDATE presentator.attachments
       SET prompt = $1, updated_at = now()
       WHERE id = $2 AND user_id = $3
       RETURNING id, original_name, mime_type, file_size, prompt, created_at, updated_at`,
      [newPrompt || null, req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const select = await query(
      `SELECT id, file_path
       FROM presentator.attachments
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (select.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const { file_path } = select.rows[0];
    await query(`DELETE FROM presentator.attachments WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);

    try {
      fs.unlinkSync(file_path);
    } catch (e) {
      console.warn('Failed to delete attachment file:', e.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

