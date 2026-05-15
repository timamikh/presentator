const express = require('express');
const cors = require('cors');
const config = require('./config');
const { query } = require('./db');
const authRouter = require('./routes/auth');
const jobsRouter = require('./routes/jobs');
const settingsRouter = require('./routes/settings');
const foldersRouter = require('./routes/folders');
const attachmentsRouter = require('./routes/attachments');
const filesRouter = require('./routes/files');
const designPresetsRouter = require('./routes/designPresets');
const metricsRouter = require('./routes/metrics');
const draftsRouter = require('./routes/drafts');
const snapshotsRouter = require('./routes/snapshots');
const { markStaleJobsAsError } = require('./services/staleJobSweeper');

const app = express();

app.use(cors());
// 10mb is enough for textual descriptions and aggregated metadata; we never
// transport file bodies in JSON (use multipart for uploads, file URLs everywhere else).
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
// Sub-router for job snapshots — mounted on the same /api/jobs/:id path so
// snapshot URLs read naturally (/api/jobs/<id>/snapshots/...).
app.use('/api/jobs/:id/snapshots', snapshotsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/files', filesRouter);
app.use('/api/design-presets', designPresetsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/drafts', draftsRouter);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Stale-job sweeper: cancels jobs stuck in any "processing_*" / "processing"
// state for longer than processingTimeoutMinutes. Also flips any running
// pipeline step belonging to those jobs to 'error' so the UI can show why
// the stage failed. Implementation lives in services/staleJobSweeper.js
// (testable in isolation).
setInterval(async () => {
  try {
    const { staleJobIds } = await markStaleJobsAsError({
      query,
      timeoutMinutes: config.processingTimeoutMinutes,
    });
    if (staleJobIds.length > 0) {
      console.warn(`Marked ${staleJobIds.length} stale processing job(s) as error.`);
    }
  } catch (err) {
    console.error('Stale job sweeper error:', err.message);
  }
}, 60 * 1000);

app.listen(config.port, () => {
  console.log(`API Service running on port ${config.port}`);
});
