const express = require('express');
const cors = require('cors');
const config = require('./config');
const { query } = require('./db');
const authRouter = require('./routes/auth');
const jobsRouter = require('./routes/jobs');
const settingsRouter = require('./routes/settings');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/settings', settingsRouter);

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
