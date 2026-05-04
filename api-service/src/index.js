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
app.use('/api/settings', settingsRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/files', filesRouter);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

setInterval(async () => {
  try {
    const timeoutMinutes = Math.max(1, config.processingTimeoutMinutes);
    const result = await query(
      `UPDATE presentator.jobs
       SET status = 'error',
           error_message = $1,
           updated_at = now()
       WHERE status = 'processing'
         AND updated_at < now() - ($2::text || ' minutes')::interval
       RETURNING id`,
      ['Pipeline timeout: job exceeded processing window', String(timeoutMinutes)],
    );

    if (result.rowCount > 0) {
      console.warn(`Marked ${result.rowCount} stale processing job(s) as error.`);
    }
  } catch (err) {
    console.error('Stale job sweeper error:', err.message);
  }
}, 60 * 1000);

app.listen(config.port, () => {
  console.log(`API Service running on port ${config.port}`);
});
