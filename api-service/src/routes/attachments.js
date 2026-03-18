const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = Router();

const LIBRARY_DIR = path.join('/data', 'library');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeFilename(name) {
  const base = typeof name === 'string' ? name : 'file';
  // keep unicode, just strip path separators
  return base.replace(/[\\/]/g, '_');
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(LIBRARY_DIR);
      cb(null, LIBRARY_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, safeFilename(file.originalname));
    },
  }),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
});

router.get('/', authRequired, async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';

    const where = ['user_id = $1'];
    const params = [req.user.id];
    let idx = 2;

    if (q) {
      where.push(`original_name ILIKE $${idx}`);
      params.push(`%${q}%`);
      idx += 1;
    }

    if (type) {
      if (type === 'image') {
        where.push(`mime_type ILIKE 'image/%'`);
      } else {
        where.push(`mime_type ILIKE $${idx}`);
        params.push(`${type}/%`);
        idx += 1;
      }
    }

    const result = await query(
      `SELECT id, original_name, mime_type, file_size, prompt, created_at
       FROM presentator.attachments
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 200`,
      params,
    );

    const rows = result.rows.map((r) => ({
      ...r,
      used_in_jobs: 0,
    }));

    return res.json(rows);
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

    const id = uuidv4();
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    const attachmentDir = path.join(LIBRARY_DIR, id);
    ensureDir(attachmentDir);

    const finalName = safeFilename(req.file.originalname);
    const finalPath = path.join(attachmentDir, finalName);

    fs.renameSync(req.file.path, finalPath);

    const mimeType = req.file.mimetype || 'application/octet-stream';
    const fileSize = Number.isFinite(Number(req.file.size)) ? Number(req.file.size) : null;

    await query(
      `INSERT INTO presentator.attachments (
         id, user_id, original_name, mime_type, file_size, prompt, file_path, created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())`,
      [id, req.user.id, finalName, mimeType, fileSize, prompt || null, finalPath],
    );

    return res.status(201).json({ id });
  } catch (err) {
    console.error('Create attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const id = req.params.id;
    const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';

    const result = await query(
      `UPDATE presentator.attachments
       SET prompt = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, prompt`,
      [id, req.user.id, value || null],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update attachment prompt error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const id = req.params.id;

    const result = await query(
      `DELETE FROM presentator.attachments
       WHERE id = $1 AND user_id = $2
       RETURNING file_path`,
      [id, req.user.id],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const fp = result.rows[0].file_path;
    try {
      if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
      const dir = path.join(LIBRARY_DIR, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Delete attachment file warning:', e.message);
    }

    return res.status(204).send();
  } catch (err) {
    console.error('Delete attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

