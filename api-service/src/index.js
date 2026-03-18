const express = require('express');
const cors = require('cors');
const config = require('./config');
const authRouter = require('./routes/auth');
const jobsRouter = require('./routes/jobs');
const settingsRouter = require('./routes/settings');
const attachmentsRouter = require('./routes/attachments');
const filesRouter = require('./routes/files');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Backward-compatible health alias (some clients may probe /api/health)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/files', filesRouter);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`API Service running on port ${config.port}`);
});
