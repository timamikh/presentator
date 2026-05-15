// Job snapshots: REST wrapper around services/snapshots.js.
//
// Snapshots back the "versions" panel in the UI. Auto-snapshots are written
// by pipeline.completeStage; this router handles manual user actions:
//   • GET    /api/jobs/:id/snapshots
//   • GET    /api/jobs/:id/snapshots/:version
//   • POST   /api/jobs/:id/snapshots             { label? }       (manual save)
//   • POST   /api/jobs/:id/snapshots/:version/restore             (rollback)
//
// All endpoints check ownership via presentator.jobs.user_id.

const { Router } = require('express');
const { authRequired } = require('../middleware/auth');
const { query } = require('../db');
const {
  createSnapshot,
  listSnapshots,
  getSnapshotByVersion,
  restoreSnapshot,
} = require('../services/snapshots');

const router = Router({ mergeParams: true });

async function assertJobOwnership(jobId, userId) {
  const res = await query(
    `SELECT 1 FROM presentator.jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId],
  );
  if (res.rows.length === 0) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
}

router.get('/', authRequired, async (req, res) => {
  try {
    await assertJobOwnership(req.params.id, req.user.id);
    const rows = await listSnapshots(req.params.id, { query });
    return res.json(rows);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:version', authRequired, async (req, res) => {
  try {
    await assertJobOwnership(req.params.id, req.user.id);
    const v = Number(req.params.version);
    if (!Number.isFinite(v)) {
      return res.status(400).json({ error: 'Invalid version' });
    }
    const snap = await getSnapshotByVersion(req.params.id, v, { query });
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    return res.json(snap);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    await assertJobOwnership(req.params.id, req.user.id);
    const label =
      typeof req.body?.label === 'string' && req.body.label.trim()
        ? req.body.label.trim().slice(0, 200)
        : null;
    const snap = await createSnapshot(
      {
        jobId: req.params.id,
        kind: 'manual',
        label,
        createdByUserId: req.user.id,
      },
      { query },
    );
    return res.status(201).json(snap);
  } catch (err) {
    console.error('Create snapshot error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:version/restore', authRequired, async (req, res) => {
  try {
    await assertJobOwnership(req.params.id, req.user.id);
    const v = Number(req.params.version);
    if (!Number.isFinite(v)) {
      return res.status(400).json({ error: 'Invalid version' });
    }
    const result = await restoreSnapshot(
      { jobId: req.params.id, version: v, userId: req.user.id },
      { query },
    );
    return res.json(result);
  } catch (err) {
    console.error('Restore snapshot error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
