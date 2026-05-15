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
const {
  STAGES,
  isStage,
  startStage,
  completeStage,
  loadAllStages,
} = require('../services/pipeline');

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
      designBrief,
      pipelineVersion,
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
    const parsedDesignBrief = parseJsonField(designBrief, 'designBrief');
    const parsedVersion = Number(pipelineVersion);
    const version = parsedVersion === 1 || parsedVersion === 2 ? parsedVersion : 2;

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
         slide_prompts, presentation_settings, system_prompt,
         design_input, pipeline_version, current_stage, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, NULL, now(), now())`,
      [
        jobId,
        req.user.id,
        prompt,
        JSON.stringify(filePaths),
        normalizedSlideCount,
        JSON.stringify(parsedSlidePrompts),
        JSON.stringify(parsedPresentationSettings),
        systemPrompt || null,
        parsedDesignBrief ? JSON.stringify(parsedDesignBrief) : null,
        version,
      ],
    );

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
      }
    }

    await client.query('COMMIT');

    if (version === 1) {
      // Legacy single-pass workflow (pipeline_version=1) — kept for
      // backwards compatibility with old jobs / existing n8n workflow.
      triggerLegacyWebhook(jobId);
    } else {
      // New staged pipeline: kick off Planning stage. Subsequent stages are
      // triggered explicitly by the user via /api/jobs/:id/stages/:stage/start.
      try {
        await startStage({ jobId, stage: 'planning' });
      } catch (err) {
        console.error(`Failed to start planning stage for ${jobId}:`, err.message);
        await query(
          `UPDATE presentator.jobs SET status = 'error', error_message = $1 WHERE id = $2`,
          [err.message, jobId],
        );
      }
    }

    return res.status(202).json({ id: jobId, status: 'pending', pipeline_version: version });
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
      `SELECT id, prompt, status, current_stage, pipeline_version,
              created_at, updated_at
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
      `SELECT 1 FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
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
      `SELECT id, user_id, prompt, status, current_stage, pipeline_version,
              file_paths, slide_data, planning_result, design_brief, design_input,
              result_path, result_paths, error_message, slide_count, slide_prompts,
              presentation_settings, system_prompt, llm_request, llm_response,
              created_at, updated_at
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

// ── Staged pipeline management ──────────────────────────────────────

router.get('/:id/steps', authRequired, async (req, res) => {
  try {
    const ownerCheck = await query(
      `SELECT 1 FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const steps = await loadAllStages(req.params.id);
    return res.json(steps);
  } catch (err) {
    console.error('List steps error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/stages/:stage/start', authRequired, async (req, res) => {
  try {
    const { id, stage } = req.params;
    if (!isStage(stage)) {
      return res.status(400).json({ error: `Unknown stage: ${stage}` });
    }
    const ownerCheck = await query(
      `SELECT 1 FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const overrides = {};
    if (req.body?.planning_result !== undefined) {
      overrides.planning_result = req.body.planning_result;
    }
    if (req.body?.design_brief !== undefined) {
      overrides.design_brief = req.body.design_brief;
    }
    if (typeof req.body?.refinePrompt === 'string') {
      overrides.refinePrompt = req.body.refinePrompt;
    }
    if (typeof req.body?.slideIndex === 'number') {
      overrides.slideIndex = req.body.slideIndex;
    }

    const result = await startStage({ jobId: id, stage, overrides });
    return res.status(202).json(result);
  } catch (err) {
    console.error('Start stage error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  }
});

router.post('/:id/refine', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const ownerCheck = await query(
      `SELECT 1 FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (typeof req.body?.prompt !== 'string' || !req.body.prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    const overrides = {
      refinePrompt: req.body.prompt.trim(),
      slideIndex:
        typeof req.body.slideIndex === 'number' ? req.body.slideIndex : null,
    };

    const result = await startStage({
      jobId: id,
      stage: 'refine_layout',
      overrides,
    });
    return res.status(202).json(result);
  } catch (err) {
    console.error('Refine error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal error' });
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

// ─── Internal routes (n8n callbacks) ───────────────────────────────

// Legacy callback: PATCH /api/jobs/internal/:id — single-pass updates for
// pipeline_version=1 jobs and for the converter's "done" callback (which is
// shared between v1 and v2 layout/refine paths).
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
       RETURNING id, user_id, status, current_stage`,
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

// Stage-aware callback: PATCH /api/jobs/internal/:id/steps/:stage
// body: {
//   output, llmRequest?, llmResponse?, errorMessage?,
//   model?, provider?, latencyMs?   // observability fields, optional
// }
router.patch('/internal/:id/steps/:stage', internalAuth, async (req, res) => {
  try {
    const { id, stage } = req.params;
    if (!isStage(stage)) {
      return res.status(400).json({ error: `Unknown stage: ${stage}` });
    }
    const {
      output,
      llmRequest,
      llmResponse,
      errorMessage,
      model,
      provider,
      latencyMs,
    } = req.body || {};
    const result = await completeStage({
      jobId: id,
      stage,
      output,
      llmRequest,
      llmResponse,
      errorMessage,
      model,
      provider,
      latencyMs,
    });
    return res.json(result);
  } catch (err) {
    console.error('Complete stage error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────

// Legacy webhook trigger for pipeline_version=1 (single-pass) jobs.
async function triggerLegacyWebhook(jobId) {
  try {
    const job = await query(
      `SELECT id, prompt, file_paths, slide_count, slide_prompts,
              presentation_settings, system_prompt, user_id
         FROM presentator.jobs WHERE id = $1`,
      [jobId],
    );
    if (job.rows.length === 0) return;
    const row = job.rows[0];

    const attRes = await query(
      `SELECT a.ref, a.kind, a.original_name, a.mime_type, a.file_size,
              a.storage_path, a.id, a.width, a.height, a.content_summary,
              ja.description_snapshot
         FROM presentator.job_attachments ja
         JOIN presentator.attachments a ON a.id = ja.attachment_id
        WHERE ja.job_id = $1
        ORDER BY ja.sort_order, ja.created_at`,
      [jobId],
    );

    const attachments = [];
    const attachmentMap = {};
    for (const r of attRes.rows) {
      attachments.push({
        ref: r.ref,
        kind: r.kind,
        filename: r.original_name,
        mimeType: r.mime_type,
        fileSize: r.file_size,
        description: r.description_snapshot || null,
        summary: r.content_summary || null,
        width: r.width,
        height: r.height,
      });
      attachmentMap[r.ref] = {
        id: r.id,
        localPath: r.storage_path,
        mimeType: r.mime_type,
        filename: r.original_name,
      };
    }

    fetch(config.n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        // legacy: no `stage` — Switch in v2 workflow falls through to legacy
        prompt: row.prompt,
        filePaths: row.file_paths || [],
        userId: row.user_id,
        promptMeta: {
          slideCount: row.slide_count,
          slidePrompts: row.slide_prompts || [],
          presentationSettings: row.presentation_settings || {},
          systemPrompt: row.system_prompt || null,
        },
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
      console.error(`Legacy n8n webhook failed for ${jobId}:`, err.message);
    });
  } catch (err) {
    console.error(`triggerLegacyWebhook ${jobId} failed:`, err.message);
  }
}

module.exports = router;
