// REST surface for the /metrics dashboard. All endpoints are read-only and
// scoped to the authenticated user — there is no admin/global view yet.
//
// /api/metrics/summary       → headline numbers (last N days)
// /api/metrics/by-stage      → tokens / latency split by pipeline stage
// /api/metrics/by-day        → daily totals for the chart
// /api/metrics/by-model      → split by LLM model
// /api/metrics/recent-calls  → table of latest llm_call_logs rows
// /api/metrics/calls/:id     → full raw_request / raw_response for one call

const { Router } = require('express');
const { authRequired } = require('../middleware/auth');
const { query } = require('../db');
const {
  parseDaysParam,
  getSummary,
  getByStage,
  getByDay,
  getByModel,
  getRecentCalls,
  getCallById,
} = require('../services/metrics');

const router = Router();

router.get('/summary', authRequired, async (req, res) => {
  try {
    const days = parseDaysParam(req.query.days);
    const summary = await getSummary({ userId: req.user.id, days }, { query });
    return res.json({ days, summary });
  } catch (err) {
    console.error('metrics/summary error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/by-stage', authRequired, async (req, res) => {
  try {
    const days = parseDaysParam(req.query.days);
    const rows = await getByStage({ userId: req.user.id, days }, { query });
    return res.json({ days, rows });
  } catch (err) {
    console.error('metrics/by-stage error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/by-day', authRequired, async (req, res) => {
  try {
    const days = parseDaysParam(req.query.days);
    const rows = await getByDay({ userId: req.user.id, days }, { query });
    return res.json({ days, rows });
  } catch (err) {
    console.error('metrics/by-day error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/by-model', authRequired, async (req, res) => {
  try {
    const days = parseDaysParam(req.query.days);
    const rows = await getByModel({ userId: req.user.id, days }, { query });
    return res.json({ days, rows });
  } catch (err) {
    console.error('metrics/by-model error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/recent-calls', authRequired, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const rows = await getRecentCalls(
      { userId: req.user.id, limit },
      { query },
    );
    return res.json({ rows });
  } catch (err) {
    console.error('metrics/recent-calls error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/calls/:id', authRequired, async (req, res) => {
  try {
    const row = await getCallById(
      { userId: req.user.id, id: req.params.id },
      { query },
    );
    if (!row) return res.status(404).json({ error: 'Call not found' });
    return res.json(row);
  } catch (err) {
    console.error('metrics/calls/:id error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
