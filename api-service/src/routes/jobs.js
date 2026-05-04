const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool, query } = require('../db');
const { authRequired, internalAuth } = require('../middleware/auth');
const { substituteSlideDataTokens } = require('../utils/attachmentTokens');

const UPLOAD_DIR = path.join('/data', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage, limits: { files: 10 } });

const router = Router();

function authFromBearerOrQuery(req, res, next) {
  const header = req.headers.authorization;
  let token = null;

  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.id, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Extracts the raw bearer token from the request, used as a query param when
// rewriting {{attachment:<ref>}} → /api/files/attachment/<id>?token=<jwt> in
// GET /api/jobs/:id responses (so the iframe preview can load images).
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

function parseJsonField(raw, fieldName) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse ${fieldName}:`, e.message);
    return null;
  }
}

// ─── Authenticated routes ───────────────────────────────────────────

router.post('/', authRequired, upload.array('files', 10), async (req, res) => {
  const client = await pool.connect();
  let jobDirCreated = null;

  try {
    const {
      prompt,
      slideCount,
      slidePrompts,
      presentationSettings,
      systemPrompt,
      attachments,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const jobId = uuidv4();
    const jobDir = path.join(UPLOAD_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    jobDirCreated = jobDir;

    const filePaths = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const dest = path.join(jobDir, file.originalname);
        fs.renameSync(file.path, dest);
        filePaths.push(dest);
      }
    }

    const normalizedSlideCount = Number.isFinite(Number(slideCount)) ? Number(slideCount) : 0;
    const parsedSlidePrompts = parseJsonField(slidePrompts, 'slidePrompts') || [];
    const parsedPresentationSettings = parseJsonField(presentationSettings, 'presentationSettings') || {};
    const parsedAttachments = parseJsonField(attachments, 'attachments') || [];

    let attachmentRows = [];
    if (Array.isArray(parsedAttachments) && parsedAttachments.length > 0) {
      const ids = parsedAttachments
        .map((a) => (a && typeof a.attachmentId === 'string' ? a.attachmentId : null))
        .filter(Boolean);
      if (ids.length > 0) {
        const lookup = await client.query(
          `SELECT id, ref, original_name, storage_path, mime_type, file_size,
                  kind, description, width, height
           FROM presentator.attachments
           WHERE user_id = $1 AND id = ANY($2::uuid[])`,
          [req.user.id, ids],
        );
        attachmentRows = lookup.rows;

        const foundIds = new Set(attachmentRows.map((r) => r.id));
        const missing = ids.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          return res.status(400).json({
            error: 'Some attachments not found or not owned by user',
            missing,
          });
        }
      }
    }

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO presentator.jobs (
         id, user_id, prompt, status, file_paths, slide_count,
         slide_prompts, presentation_settings, system_prompt, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, now(), now())`,
      [
        jobId,
        req.user.id,
        prompt,
        JSON.stringify(filePaths),
        normalizedSlideCount,
        JSON.stringify(parsedSlidePrompts),
        JSON.stringify(parsedPresentationSettings),
        systemPrompt || null,
      ],
    );

    const attachmentsBySpecOrder = [];
    if (Array.isArray(parsedAttachments) && attachmentRows.length > 0) {
      const byId = new Map(attachmentRows.map((r) => [r.id, r]));
      for (let i = 0; i < parsedAttachments.length; i++) {
        const spec = parsedAttachments[i];
        if (!spec || typeof spec.attachmentId !== 'string') continue;
        const row = byId.get(spec.attachmentId);
        if (!row) continue;
        const description =
          typeof spec.description === 'string' && spec.description.trim()
            ? spec.description.trim()
            : row.description || null;

        await client.query(
          `INSERT INTO presentator.job_attachments
             (job_id, attachment_id, description_snapshot, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (job_id, attachment_id) DO NOTHING`,
          [jobId, row.id, description, i],
        );

        attachmentsBySpecOrder.push({ row, description, sortOrder: i });
      }
    }

    await client.query('COMMIT');

    triggerWebhook(
      jobId,
      prompt,
      filePaths,
      req.user.id,
      {
        slideCount: normalizedSlideCount,
        slidePrompts: parsedSlidePrompts,
        presentationSettings: parsedPresentationSettings,
        systemPrompt: systemPrompt || null,
      },
      attachmentsBySpecOrder,
    );

    return res.status(202).json({ id: jobId, status: 'pending' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if (jobDirCreated) {
      try { fs.rmSync(jobDirCreated, { recursive: true, force: true }); } catch {}
    }
    console.error('Job creation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, prompt, status, created_at, updated_at
       FROM presentator.jobs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('List jobs error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/uploads/:jobId/*', authFromBearerOrQuery, async (req, res) => {
  try {
    const { jobId } = req.params;
    const relativeAssetPath = req.params[0] ? decodeURIComponent(req.params[0]) : '';

    if (!relativeAssetPath) {
      return res.status(400).json({ error: 'Asset path is required' });
    }

    const ownerCheck = await query(
      `SELECT 1
       FROM presentator.jobs
       WHERE id = $1 AND user_id = $2`,
      [jobId, req.user.id],
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const jobUploadDir = path.join(UPLOAD_DIR, jobId);
    const resolvedPath = path.resolve(jobUploadDir, relativeAssetPath);
    const allowedPrefix = `${jobUploadDir}${path.sep}`;
    if (resolvedPath !== jobUploadDir && !resolvedPath.startsWith(allowedPrefix)) {
      return res.status(403).json({ error: 'Forbidden path' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    return res.sendFile(resolvedPath);
  } catch (err) {
    console.error('Get upload asset error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT id,
              user_id,
              prompt,
              status,
              file_paths,
              slide_data,
              result_path,
              result_paths,
              error_message,
              slide_count,
              slide_prompts,
              presentation_settings,
              system_prompt,
              llm_request,
              llm_response,
              created_at,
              updated_at
       FROM presentator.jobs
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const row = result.rows[0];

    const attachmentsResult = await query(
      `SELECT a.id, a.ref, a.original_name, a.mime_type, a.kind, a.width, a.height,
              ja.description_snapshot, ja.sort_order
       FROM presentator.job_attachments ja
       JOIN presentator.attachments a ON a.id = ja.attachment_id
       WHERE ja.job_id = $1
       ORDER BY ja.sort_order, ja.created_at`,
      [req.params.id],
    );
    const jobAttachments = attachmentsResult.rows;

    // Substitute {{attachment:<ref>}} placeholders in slide_data on the fly with
    // private file URLs so the frontend iframe preview can load the images
    // without further client-side rewriting. The DB stays "clean" with raw tokens.
    if (row.slide_data && jobAttachments.length > 0) {
      const token = extractBearerToken(req);
      const refToId = new Map(jobAttachments.map((a) => [a.ref, a.id]));
      row.slide_data = substituteSlideDataTokens(row.slide_data, (ref) => {
        const id = refToId.get(ref);
        if (!id) return null;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        return `/api/files/attachment/${id}${tokenParam}`;
      });
    }

    row.attachments = jobAttachments;

    return res.json(row);
  } catch (err) {
    console.error('Get job error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/download', authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, status, result_path, result_paths
       FROM presentator.jobs
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];
    if (job.status !== 'done') {
      return res.status(404).json({ error: 'Result not ready' });
    }

    const format = req.query.format || 'pdf';
    let filePath = null;

    if (job.result_paths && job.result_paths[format]) {
      filePath = job.result_paths[format];
    } else if (job.result_path) {
      filePath = job.result_path;
    }

    if (!filePath) {
      return res.status(404).json({ error: `Format "${format}" not available` });
    }

    return res.download(filePath);
  } catch (err) {
    console.error('Download error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Internal route (n8n callbacks) ─────────────────────────────────

router.patch('/internal/:id', internalAuth, async (req, res) => {
  try {
    const {
      status,
      slideData,
      resultPath,
      resultPaths,
      errorMessage,
      llmRequest,
      llmResponse,
    } = req.body;
    const sets = [];
    const params = [];
    let idx = 1;

    if (status !== undefined) {
      sets.push(`status = $${idx++}`);
      params.push(status);
    }
    if (slideData !== undefined) {
      sets.push(`slide_data = $${idx++}`);
      params.push(JSON.stringify(slideData));
    }
    if (resultPath !== undefined) {
      sets.push(`result_path = $${idx++}`);
      params.push(resultPath);
    }
    if (resultPaths !== undefined) {
      sets.push(`result_paths = $${idx++}`);
      params.push(JSON.stringify(resultPaths));
    }
    if (errorMessage !== undefined) {
      sets.push(`error_message = $${idx++}`);
      params.push(errorMessage);
    }

    if (llmRequest !== undefined) {
      sets.push(`llm_request = $${idx++}`);
      params.push(JSON.stringify(llmRequest));
    }

    if (llmResponse !== undefined) {
      sets.push(`llm_response = $${idx++}`);
      params.push(JSON.stringify(llmResponse));
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const result = await query(
      `UPDATE presentator.jobs
       SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING id, user_id, prompt, status, slide_data, result_path, result_paths, error_message, created_at, updated_at`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Internal update error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────

function buildAttachmentPayload(attachmentEntries) {
  const attachments = [];
  const attachmentMap = {};

  for (const entry of attachmentEntries) {
    const { row, description } = entry;
    attachments.push({
      ref: row.ref,
      kind: row.kind,
      filename: row.original_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      description: description || null,
      width: row.width,
      height: row.height,
    });
    attachmentMap[row.ref] = {
      id: row.id,
      localPath: row.storage_path,
      mimeType: row.mime_type,
      filename: row.original_name,
    };
  }

  return { attachments, attachmentMap };
}

function triggerWebhook(jobId, prompt, filePaths, userId, promptMeta, attachmentEntries = []) {
  const { attachments, attachmentMap } = buildAttachmentPayload(attachmentEntries);

  fetch(config.n8nWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      prompt,
      filePaths,
      userId,
      promptMeta,
      attachments,
      attachmentMap,
      _secrets: {
        internalApiKey: config.internalApiKey,
        llmApiKey: process.env.LLM_API_KEY || '',
        llmBaseUrl: process.env.LLM_BASE_URL || 'https://openai-hub.neuraldeep.tech/v1',
        llmModel: process.env.LLM_MODEL || 'qwen3-30b-a3b-instruct-2507',
      },
    }),
  }).catch((err) => {
    console.error(`n8n webhook failed for job ${jobId}:`, err.message);
  });
}

module.exports = router;
