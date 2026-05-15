// Draft form state for /create. Decoupled from jobs — a draft is "what the
// user typed before submitting the pipeline".
//
//   GET    /api/drafts                 → list current user's drafts (no version history)
//   POST   /api/drafts                 → create new draft (writes initial version)
//   GET    /api/drafts/:id             → fetch draft body (head version)
//   PUT    /api/drafts/:id             → update + bump head_version + insert version
//   DELETE /api/drafts/:id             → drop draft and all its versions
//   GET    /api/drafts/:id/versions    → audit log
//   POST   /api/drafts/:id/versions/:version/restore → restore + new head

const { Router } = require('express');
const { authRequired } = require('../middleware/auth');
const { query } = require('../db');
const {
  createDraft,
  updateDraft,
  listDrafts,
  getDraft,
  listDraftVersions,
  restoreDraftVersion,
  deleteDraft,
} = require('../services/drafts');

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const rows = await listDrafts(req.user.id, { query });
    return res.json(rows);
  } catch (err) {
    console.error('list drafts error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const draft = await createDraft(
      { userId: req.user.id, payload: req.body || {} },
      { query },
    );
    return res.status(201).json(draft);
  } catch (err) {
    console.error('create draft error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const draft = await getDraft(req.user.id, req.params.id, { query });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    return res.json(draft);
  } catch (err) {
    console.error('get draft error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const updated = await updateDraft(
      { userId: req.user.id, draftId: req.params.id, payload: req.body || {} },
      { query },
    );
    return res.json(updated);
  } catch (err) {
    console.error('update draft error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await deleteDraft(req.user.id, req.params.id, { query });
    return res.json(result);
  } catch (err) {
    console.error('delete draft error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id/versions', authRequired, async (req, res) => {
  try {
    const rows = await listDraftVersions(req.user.id, req.params.id, { query });
    return res.json(rows);
  } catch (err) {
    console.error('list draft versions error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/versions/:version/restore', authRequired, async (req, res) => {
  try {
    const v = Number(req.params.version);
    if (!Number.isFinite(v)) {
      return res.status(400).json({ error: 'Invalid version' });
    }
    const result = await restoreDraftVersion(
      { userId: req.user.id, draftId: req.params.id, version: v },
      { query },
    );
    return res.json(result);
  } catch (err) {
    console.error('restore draft error:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
