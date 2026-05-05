const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { pool, query } = require('../db');
const { authRequired, internalAuth } = require('../middleware/auth');

const LIBRARY_DIR = path.join('/data', 'library');
const REF_PREFIX = 'att_';
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_EXTRACTED_TEXT_LENGTH = 200_000;
const EXTRACTION_STATUSES = ['pending', 'processing', 'done', 'failed', 'skipped'];

// Fire-and-forget HTTP call to the Python extractor. Failures are logged but
// never propagated — the upload itself must succeed even when the worker is
// unreachable (idempotent re-tries can be triggered manually via ?force=true).
function triggerExtraction(attachmentId, { force = false } = {}) {
  const url = `${config.extractorBaseUrl}/extract`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': config.internalApiKey,
    },
    body: JSON.stringify({ attachmentId, force }),
  }).catch((err) => {
    console.warn(`extractor trigger failed for ${attachmentId}: ${err.message}`);
  });
}

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
         description, width, height, extraction_status, extracted_at,
         extraction_error, content_summary, created_at, updated_at
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
           mime_type, file_size, kind, description, extraction_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
         RETURNING id, folder_id, ref, original_name, mime_type, file_size, kind,
                   description, width, height, extraction_status, extracted_at,
                   extraction_error, content_summary, created_at, updated_at`,
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

      // Asynchronously kick off extraction. The user gets a 201 immediately;
      // the worker writes back extracted_text / content_summary / dimensions
      // via PATCH /api/attachments/internal/:id.
      triggerExtraction(id);

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
                 description, width, height, extraction_status, extracted_at,
                 extraction_error, content_summary, created_at, updated_at`,
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

// POST /api/attachments/:id/reextract — manual re-trigger for the worker.
// Useful when extraction failed transiently or when the file was replaced.
router.post('/:id/reextract', authRequired, async (req, res) => {
  try {
    const result = await query(
      `UPDATE presentator.attachments
       SET extraction_status = 'pending',
           extraction_error = NULL,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, extraction_status`,
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    triggerExtraction(req.params.id, { force: true });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Re-extract error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Internal callback for extractor-service ──────────────────────────
// PATCH /api/attachments/internal/:id  body: { extractionStatus, extractedText?,
//                                              contentSummary?, extractionError?,
//                                              width?, height? }
// GET   /api/attachments/internal/:id  → row needed by the worker
router.get('/internal/:id', internalAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, user_id, folder_id, ref, original_name, storage_path, mime_type,
              file_size, kind, description, extraction_status, extracted_at,
              extraction_error, content_summary, width, height
       FROM presentator.attachments
       WHERE id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Internal get attachment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/internal/:id', internalAuth, async (req, res) => {
  try {
    const sets = [];
    const params = [];
    let idx = 1;

    if (req.body?.extractionStatus !== undefined) {
      const value = String(req.body.extractionStatus);
      if (!EXTRACTION_STATUSES.includes(value)) {
        return res.status(400).json({
          error: `extractionStatus must be one of: ${EXTRACTION_STATUSES.join(', ')}`,
        });
      }
      sets.push(`extraction_status = $${idx++}`);
      params.push(value);
      if (value === 'done' || value === 'skipped') {
        sets.push(`extracted_at = now()`);
      }
    }

    if (req.body?.extractedText !== undefined) {
      let value = req.body.extractedText;
      if (value !== null) {
        if (typeof value !== 'string') {
          return res.status(400).json({ error: 'extractedText must be string or null' });
        }
        if (value.length > MAX_EXTRACTED_TEXT_LENGTH) {
          value = value.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
        }
      }
      sets.push(`extracted_text = $${idx++}`);
      params.push(value);
    }

    if (req.body?.contentSummary !== undefined) {
      const value = req.body.contentSummary;
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: 'contentSummary must be string or null' });
      }
      sets.push(`content_summary = $${idx++}`);
      params.push(value);
    }

    if (req.body?.extractionError !== undefined) {
      const value = req.body.extractionError;
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: 'extractionError must be string or null' });
      }
      sets.push(`extraction_error = $${idx++}`);
      params.push(value);
    }

    if (req.body?.width !== undefined) {
      const value = req.body.width === null ? null : Number(req.body.width);
      if (value !== null && !Number.isFinite(value)) {
        return res.status(400).json({ error: 'width must be a number or null' });
      }
      sets.push(`width = $${idx++}`);
      params.push(value === null ? null : Math.round(value));
    }

    if (req.body?.height !== undefined) {
      const value = req.body.height === null ? null : Number(req.body.height);
      if (value !== null && !Number.isFinite(value)) {
        return res.status(400).json({ error: 'height must be a number or null' });
      }
      sets.push(`height = $${idx++}`);
      params.push(value === null ? null : Math.round(value));
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const result = await query(
      `UPDATE presentator.attachments
       SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING id, ref, kind, mime_type, extraction_status, extracted_at,
                 extraction_error, content_summary, width, height`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Internal update attachment error:', err.message);
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
