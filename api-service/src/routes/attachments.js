const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool, query } = require('../db');
const { authRequired } = require('../middleware/auth');

const LIBRARY_DIR = path.join('/data', 'library');
const REF_PREFIX = 'att_';
const MAX_DESCRIPTION_LENGTH = 4000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeBaseName(originalName) {
  const base = path.basename(originalName || 'file');
  return base.replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
}

// Multer keeps the upload in /data/library/<uid>/ tmp dir initially;
// final filename uses the attachment id and a sanitized base name (set after INSERT).
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(LIBRARY_DIR, req.user.id);
    try {
      ensureDir(dir);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const safe = safeBaseName(file.originalname);
    cb(null, `tmp_${uuidv4()}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 1, fileSize: 50 * 1024 * 1024 }, // 50MB hard cap per file
});

function detectKind(mime) {
  if (typeof mime !== 'string') return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('msword') ||
    mime.includes('officedocument') ||
    mime.includes('excel') ||
    mime.includes('csv') ||
    mime.includes('json') ||
    mime.includes('xml')
  ) {
    return 'document';
  }
  return 'other';
}

// Short, URL-safe ref for use inside {{attachment:<ref>}} placeholders.
// 8 random hex chars give ~4B values which is plenty for per-user library.
function generateRef() {
  return REF_PREFIX + crypto.randomBytes(4).toString('hex');
}

function normalizeFolderId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  return raw;
}

function normalizeDescription(raw) {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return trimmed.slice(0, MAX_DESCRIPTION_LENGTH);
  }
  return trimmed;
}

const router = Router();

// GET /api/attachments?folderId=&q=&kind=
// folderId="root" or absent → root level (folder_id IS NULL).
// folderId=<uuid> → only that folder.
// folderId="all" → no folder filter (whole library, used by search).
router.get('/', authRequired, async (req, res) => {
  try {
    const clauses = ['user_id = $1'];
    const params = [req.user.id];
    let idx = 2;

    const folderParam = req.query.folderId;
    if (folderParam === 'all') {
      // no folder filter
    } else if (!folderParam || folderParam === 'root' || folderParam === 'null') {
      clauses.push('folder_id IS NULL');
    } else {
      clauses.push(`folder_id = $${idx++}`);
      params.push(folderParam);
    }

    if (req.query.q && String(req.query.q).trim()) {
      clauses.push(`(original_name ILIKE $${idx} OR description ILIKE $${idx})`);
      params.push(`%${String(req.query.q).trim()}%`);
      idx++;
    }

    if (req.query.kind && ['image', 'document', 'other'].includes(req.query.kind)) {
      clauses.push(`kind = $${idx++}`);
      params.push(req.query.kind);
    }

    const result = await query(
      `SELECT
         id, folder_id, ref, original_name, mime_type, file_size, kind,
         description, width, height, created_at, updated_at
       FROM presentator.attachments
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC`,
      params,
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('List attachments error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const tmpPath = req.file.path;

  try {
    const folderId = normalizeFolderId(req.body?.folderId);
    if (folderId === undefined) {
      fs.unlinkSync(tmpPath);
      return res.status(400).json({ error: 'folderId must be a UUID string or null' });
    }
    if (folderId) {
      const folder = await query(
        `SELECT id FROM presentator.folders WHERE id = $1 AND user_id = $2`,
        [folderId, req.user.id],
      );
      if (folder.rows.length === 0) {
        fs.unlinkSync(tmpPath);
        return res.status(404).json({ error: 'Folder not found' });
      }
    }

    const description = normalizeDescription(req.body?.description) || null;
    const mimeType = req.file.mimetype || null;
    const kind = detectKind(mimeType);
    const id = uuidv4();
    const ref = generateRef();

    const finalName = `${id}_${safeBaseName(req.file.originalname)}`;
    const finalPath = path.join(path.dirname(tmpPath), finalName);
    fs.renameSync(tmpPath, finalPath);

    try {
      const inserted = await query(
        `INSERT INTO presentator.attachments (
           id, user_id, folder_id, ref, original_name, storage_path,
           mime_type, file_size, kind, description
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, folder_id, ref, original_name, mime_type, file_size, kind,
                   description, width, height, created_at, updated_at`,
        [
          id,
          req.user.id,
          folderId,
          ref,
          req.file.originalname,
          finalPath,
          mimeType,
          Number.isFinite(Number(req.file.size)) ? Number(req.file.size) : null,
          kind,
          description,
        ],
      );
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      try { fs.unlinkSync(finalPath); } catch {}
      throw err;
    }
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    console.error('Create attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', authRequired, async (req, res) => {
  try {
    const sets = [];
    const params = [];
    let idx = 1;

    if (req.body?.description !== undefined) {
      const description = normalizeDescription(req.body.description);
      if (description === undefined) {
        return res.status(400).json({ error: 'description must be a string or null' });
      }
      sets.push(`description = $${idx++}`);
      params.push(description);
    }

    if (req.body?.folderId !== undefined) {
      const folderId = normalizeFolderId(req.body.folderId);
      if (folderId === undefined) {
        return res.status(400).json({ error: 'folderId must be a UUID string or null' });
      }
      if (folderId) {
        const folder = await query(
          `SELECT id FROM presentator.folders WHERE id = $1 AND user_id = $2`,
          [folderId, req.user.id],
        );
        if (folder.rows.length === 0) {
          return res.status(404).json({ error: 'Folder not found' });
        }
      }
      sets.push(`folder_id = $${idx++}`);
      params.push(folderId);
    }

    if (req.body?.original_name !== undefined) {
      const name = typeof req.body.original_name === 'string' ? req.body.original_name.trim() : '';
      if (!name || name.length > 512) {
        return res.status(400).json({ error: 'original_name must be 1-512 chars' });
      }
      sets.push(`original_name = $${idx++}`);
      params.push(name);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    sets.push(`updated_at = now()`);
    params.push(req.params.id, req.user.id);

    const result = await query(
      `UPDATE presentator.attachments
       SET ${sets.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, folder_id, ref, original_name, mime_type, file_size, kind,
                 description, width, height, created_at, updated_at`,
      params,
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

// DELETE /api/attachments/:id — refuses if attachment is referenced by any job
// (job_attachments.attachment_id has ON DELETE RESTRICT). Pass ?force=true
// to detach the attachment from all jobs first (description_snapshot remains in jobs).
router.delete('/:id', authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const select = await client.query(
      `SELECT id, storage_path
       FROM presentator.attachments
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (select.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const usage = await client.query(
      `SELECT COUNT(*)::int AS count FROM presentator.job_attachments
       WHERE attachment_id = $1`,
      [req.params.id],
    );
    const usedInJobs = usage.rows[0].count;

    const force = req.query.force === 'true' || req.query.force === '1';
    if (usedInJobs > 0 && !force) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Attachment is used in existing jobs',
        usedInJobs,
        hint: 'Pass ?force=true to detach the attachment from these jobs and delete it',
      });
    }

    if (usedInJobs > 0) {
      await client.query(
        `DELETE FROM presentator.job_attachments WHERE attachment_id = $1`,
        [req.params.id],
      );
    }

    await client.query(
      `DELETE FROM presentator.attachments WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );

    await client.query('COMMIT');

    try {
      fs.unlinkSync(select.rows[0].storage_path);
    } catch (e) {
      console.warn('Failed to delete attachment file:', e.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Delete attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
