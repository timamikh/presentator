const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const config = require('../config');
const { query } = require('../db');
const { authRequired, internalAuth } = require('../middleware/auth');

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

// ─── Authenticated routes ───────────────────────────────────────────

router.post('/', authRequired, upload.array('files', 10), async (req, res) => {
  try {
    const {
      prompt,
      slideCount,
      slidePrompts,
      presentationSettings,
      systemPrompt,
    } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const jobId = uuidv4();
    const jobDir = path.join(UPLOAD_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const filePaths = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const dest = path.join(jobDir, file.originalname);
        fs.renameSync(file.path, dest);
        filePaths.push(dest);
      }
    }

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
      `SELECT id, status, result_path
       FROM presentator.jobs
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];
    if (job.status !== 'done' || !job.result_path) {
      return res.status(404).json({ error: 'Result not ready' });
    }

    return res.download(job.result_path);
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
       RETURNING id, user_id, prompt, status, slide_data, result_path, error_message, created_at, updated_at`,
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
  fetch(config.n8nWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  }).catch((err) => {
    console.error(`n8n webhook failed for job ${jobId}:`, err.message);
  });
}

module.exports = router;
