const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const sharp = require('sharp');
const config = require('../config');
const { pool, query } = require('../db');
const { authRequired, internalAuth } = require('../middleware/auth');

const UPLOAD_DIR = path.join('/data', 'uploads');
const LIBRARY_DIR = path.join('/data', 'library');

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

// ─── Authenticated routes ───────────────────────────────────────────

router.post('/', authRequired, upload.array('files', 10), async (req, res) => {
  try {
    const {
      prompt,
      slideCount,
      slidePrompts,
      presentationSettings,
      systemPrompt,
      attachmentIds,
      filePrompts,
    } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const jobId = uuidv4();
    const jobDir = path.join(UPLOAD_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const parsedAttachmentIds = parseJsonArray(attachmentIds);
    const parsedFilePrompts = parseJsonArray(filePrompts);
    const promptByAttachmentId = new Map();
    const promptByFileName = new Map();
    for (const p of parsedFilePrompts) {
      if (p && typeof p === 'object') {
        if (p.attachmentId && typeof p.attachmentId === 'string') {
          promptByAttachmentId.set(p.attachmentId, typeof p.prompt === 'string' ? p.prompt : '');
        }
        if (p.fileName && typeof p.fileName === 'string') {
          promptByFileName.set(p.fileName, typeof p.prompt === 'string' ? p.prompt : '');
        }
      }
    }

    const totalIncoming = (req.files?.length || 0) + parsedAttachmentIds.length;
    if (totalIncoming > 10) {
      return res.status(400).json({ error: 'Too many files (max 10 including attachments)' });
    }

    const usedAttachments = [];

    // Attachments from library
    if (parsedAttachmentIds.length > 0) {
      const rows = await query(
        `SELECT id, original_name, file_path, mime_type, file_size, prompt
         FROM presentator.attachments
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [req.user.id, parsedAttachmentIds],
      );
      for (const a of rows.rows) {
        usedAttachments.push({
          id: a.id,
          originalName: a.original_name,
          libraryPath: a.file_path,
          mimeType: a.mime_type,
          fileSize: a.file_size,
          lastPrompt: a.prompt || '',
          prompt: (promptByAttachmentId.get(a.id) || a.prompt || '').trim(),
          source: 'library',
        });
      }
    }

    // Uploaded files: create attachment in library and use it
    if (req.files && req.files.length > 0) {
      const userLibraryDir = path.join(LIBRARY_DIR, req.user.id);
      fs.mkdirSync(userLibraryDir, { recursive: true });

      for (const f of req.files) {
        const safeName = safeBaseName(f.originalname);
        const libraryFilename = `${uuidv4()}_${safeName}`;
        const libraryPath = path.join(userLibraryDir, libraryFilename);
        fs.renameSync(f.path, libraryPath);

        const filePrompt = (promptByFileName.get(f.originalname) || '').trim();
        const ins = await query(
          `INSERT INTO presentator.attachments (
             user_id, original_name, file_path, mime_type, file_size, prompt, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, now(), now())
           RETURNING id`,
          [
            req.user.id,
            f.originalname,
            libraryPath,
            f.mimetype || null,
            Number.isFinite(Number(f.size)) ? Number(f.size) : null,
            filePrompt || null,
          ],
        );

        usedAttachments.push({
          id: ins.rows[0].id,
          originalName: f.originalname,
          libraryPath,
          mimeType: f.mimetype || null,
          fileSize: f.size,
          lastPrompt: filePrompt || '',
          prompt: filePrompt || '',
          source: 'upload',
        });
      }
    }

    // Copy all used attachments into job directory (pipeline compatibility)
    const filePaths = [];
    for (const a of usedAttachments) {
      const destPath = uniqueDestPath(jobDir, a.originalName);
      fs.copyFileSync(a.libraryPath, destPath);
      filePaths.push(destPath);
      a.jobPath = destPath;
    }

    const fileAttachments = await buildFileAttachmentsForWebhook(usedAttachments);

    const normalizedSlideCount = Number.isFinite(Number(slideCount)) ? Number(slideCount) : 0;

    let parsedSlidePrompts = [];
    if (slidePrompts) {
      try {
        parsedSlidePrompts = typeof slidePrompts === 'string' ? JSON.parse(slidePrompts) : slidePrompts;
      } catch (e) {
        console.error('Failed to parse slidePrompts:', e.message);
      }
    }

    let parsedPresentationSettings = {};
    if (presentationSettings) {
      try {
        parsedPresentationSettings =
          typeof presentationSettings === 'string' ? JSON.parse(presentationSettings) : presentationSettings;
      } catch (e) {
        console.error('Failed to parse presentationSettings:', e.message);
      }
    }

    await query(
      `INSERT INTO presentator.jobs (
         id,
         user_id,
         prompt,
         status,
         file_paths,
         slide_count,
         slide_prompts,
         presentation_settings,
         system_prompt,
         created_at,
         updated_at
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

    // Persist job_attachments prompt snapshots + update last prompt in attachments
    for (const a of usedAttachments) {
      await query(
        `INSERT INTO presentator.job_attachments (job_id, attachment_id, prompt_snapshot, created_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (job_id, attachment_id) DO UPDATE SET prompt_snapshot = EXCLUDED.prompt_snapshot`,
        [jobId, a.id, a.prompt || null],
      );
      await query(
        `UPDATE presentator.attachments
         SET prompt = $1, updated_at = now()
         WHERE id = $2 AND user_id = $3`,
        [a.prompt || null, a.id, req.user.id],
      );
    }

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
        fileAttachments,
      },
    );

    return res.status(202).json({ id: jobId, status: 'pending' });
  } catch (err) {
    console.error('Job creation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json(result.rows[0]);
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

// ─── Revisions (refinement + restore) ────────────────────────────────

router.get('/:id/revisions', authRequired, async (req, res) => {
  try {
    const job = await query(
      `SELECT id FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const result = await query(
      `SELECT revision_number, user_message, created_at
       FROM presentator.job_revisions
       WHERE job_id = $1
       ORDER BY revision_number DESC`,
      [req.params.id],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('List revisions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/revisions', authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    await client.query('BEGIN');

    const jobRes = await client.query(
      `SELECT id,
              user_id,
              prompt,
              status,
              file_paths,
              slide_data,
              result_paths,
              slide_count,
              slide_prompts,
              presentation_settings,
              system_prompt,
              llm_request,
              llm_response
       FROM presentator.jobs
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    if (jobRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = jobRes.rows[0];
    if (!job.slide_data) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Job has no slide_data to refine yet' });
    }

    const nextRevRes = await client.query(
      `SELECT COALESCE(MAX(revision_number), 0)::int + 1 AS next_rev
       FROM presentator.job_revisions
       WHERE job_id = $1`,
      [job.id],
    );
    const nextRev = nextRevRes.rows[0].next_rev;

    await client.query(
      `INSERT INTO presentator.job_revisions (
         job_id, revision_number, slide_data, result_paths, llm_request, llm_response, user_message, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        job.id,
        nextRev,
        JSON.stringify(job.slide_data),
        job.result_paths ? JSON.stringify(job.result_paths) : null,
        job.llm_request ? JSON.stringify(job.llm_request) : null,
        job.llm_response ? JSON.stringify(job.llm_response) : null,
        message,
      ],
    );

    await client.query(
      `UPDATE presentator.jobs
       SET status = 'processing', error_message = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [job.id, req.user.id],
    );

    await client.query('COMMIT');

    const usedAttachments = await listJobAttachments(req.user.id, job.id);
    const fileAttachments = await buildFileAttachmentsForWebhook(usedAttachments);

    const cleanSlideData = stripBase64FromSlideData(job.slide_data, fileAttachments);

    triggerWebhook(job.id, job.prompt, job.file_paths || [], req.user.id, {
      refinementMode: true,
      previousSlideData: cleanSlideData,
      userMessage: message,
      slideCount: job.slide_count || 0,
      slidePrompts: job.slide_prompts || [],
      presentationSettings: job.presentation_settings || {},
      systemPrompt: job.system_prompt || null,
      fileAttachments,
    });

    return res.status(202).json({ ok: true, revisionNumber: nextRev, status: 'processing' });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('Create revision error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/:id/revisions/:rev/restore', authRequired, async (req, res) => {
  try {
    const rev = Number(req.params.rev);
    if (!Number.isFinite(rev) || rev <= 0) {
      return res.status(400).json({ error: 'Invalid revision number' });
    }

    const jobRes = await query(
      `SELECT id FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const revRes = await query(
      `SELECT slide_data, result_paths, llm_request, llm_response
       FROM presentator.job_revisions
       WHERE job_id = $1 AND revision_number = $2`,
      [req.params.id, rev],
    );
    if (revRes.rows.length === 0) {
      return res.status(404).json({ error: 'Revision not found' });
    }

    const r = revRes.rows[0];
    const upd = await query(
      `UPDATE presentator.jobs
       SET slide_data = $1,
           result_paths = $2,
           llm_request = $3,
           llm_response = $4,
           status = 'done',
           error_message = NULL,
           updated_at = now()
       WHERE id = $5 AND user_id = $6
       RETURNING id, status`,
      [
        r.slide_data ? JSON.stringify(r.slide_data) : null,
        r.result_paths ? JSON.stringify(r.result_paths) : null,
        r.llm_request ? JSON.stringify(r.llm_request) : null,
        r.llm_response ? JSON.stringify(r.llm_response) : null,
        req.params.id,
        req.user.id,
      ],
    );

    return res.json(upd.rows[0]);
  } catch (err) {
    console.error('Restore revision error:', err.message);
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

function triggerWebhook(jobId, prompt, filePaths, userId, promptMeta = {}) {
  const payload = JSON.stringify({
    jobId,
    prompt,
    filePaths,
    userId,
    promptMeta,
    _secrets: {
      internalApiKey: config.internalApiKey,
      llmApiKey: process.env.LLM_API_KEY || '',
      llmBaseUrl: process.env.LLM_BASE_URL || 'https://openai-hub.neuraldeep.tech/v1',
      llmModel: process.env.LLM_MODEL || 'qwen3-30b-a3b-instruct-2507',
    },
  });
  const sizeMB = (Buffer.byteLength(payload) / 1048576).toFixed(2);
  console.log(`[webhook] Sending ${sizeMB} MB for job ${jobId} (refinement=${!!promptMeta.refinementMode})`);
  fetch(config.n8nWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
    .then((res) => {
      if (!res.ok) {
        console.error(`[webhook] n8n responded ${res.status} for job ${jobId}`);
      }
    })
    .catch((err) => {
      console.error(`[webhook] n8n webhook failed for job ${jobId}:`, err.message);
    });
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Strip inline base64 data URIs from slide HTML to keep webhook payload small.
 * Reverses the n8n substitution: replaces data URLs back to attachment:ID using
 * fileAttachments, so the LLM can reference them properly during refinement.
 */
function stripBase64FromSlideData(slideData, fileAttachments) {
  if (!slideData || !slideData.slides) return slideData;
  const cleaned = JSON.parse(JSON.stringify(slideData));

  const reverseMap = [];
  if (Array.isArray(fileAttachments)) {
    for (const f of fileAttachments) {
      if (f && f.attachmentId && f.base64 && f.mimeType) {
        const dataUrl = `data:${f.mimeType};base64,${f.base64}`;
        reverseMap.push({ dataUrl, replacement: `attachment:${f.attachmentId}` });
      }
    }
  }

  for (const slide of cleaned.slides) {
    if (!slide.html) continue;
    for (const { dataUrl, replacement } of reverseMap) {
      while (slide.html.includes(dataUrl)) {
        slide.html = slide.html.replace(dataUrl, replacement);
      }
    }
    slide.html = slide.html.replace(
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
      '[image-removed]',
    );
  }
  return cleaned;
}

function safeBaseName(originalName) {
  const base = path.basename(originalName || 'file');
  return base.replace(/[^\w.\-() ]+/g, '_');
}

function uniqueDestPath(dir, originalName) {
  const base = safeBaseName(originalName);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let candidate = path.join(dir, base);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${i++})${ext}`);
  }
  return candidate;
}

async function buildFileAttachmentsForWebhook(usedAttachments) {
  const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const out = [];

  for (const a of usedAttachments) {
    const item = {
      attachmentId: a.id,
      name: a.originalName,
      mimeType: a.mimeType || null,
      prompt: (a.prompt || '').trim(),
      base64: null,
    };

    if (a.mimeType && IMAGE_MIME.has(a.mimeType)) {
      try {
        const buf = await sharp(a.libraryPath)
          .resize({ width: 1920, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        item.base64 = buf.toString('base64');
        item.mimeType = 'image/jpeg';
      } catch (e) {
        console.warn('Failed to prepare image base64:', e.message);
      }
    }

    out.push(item);
  }

  return out;
}

async function listJobAttachments(userId, jobId) {
  const result = await query(
    `SELECT a.id,
            a.original_name,
            a.file_path,
            a.mime_type,
            a.file_size,
            a.prompt,
            ja.prompt_snapshot
     FROM presentator.job_attachments ja
     JOIN presentator.attachments a ON a.id = ja.attachment_id
     JOIN presentator.jobs j ON j.id = ja.job_id
     WHERE ja.job_id = $1 AND j.user_id = $2`,
    [jobId, userId],
  );

  return result.rows.map((r) => ({
    id: r.id,
    originalName: r.original_name,
    libraryPath: r.file_path,
    mimeType: r.mime_type,
    fileSize: r.file_size,
    lastPrompt: r.prompt || '',
    prompt: (r.prompt_snapshot || r.prompt || '').trim(),
    source: 'job',
  }));
}

module.exports = router;
