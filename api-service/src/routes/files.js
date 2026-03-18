const { Router } = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const config = require('../config');

const router = Router();

function resolveAuthToken(req) {
  const header = req.headers.authorization;
  if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

function requireAuthForBinary(req, res, next) {
  const token = resolveAuthToken(req);
  if (!token) return res.status(401).json({ error: 'Authorization token required' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.id, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// This route is used by <img src="...">, so it must support token query param.
router.get('/attachment/:id', requireAuthForBinary, async (req, res) => {
  try {
    const id = req.params.id;

    const result = await query(
      `SELECT file_path, mime_type, original_name
       FROM presentator.attachments
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];

    const fp = row.file_path;
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'File missing' });

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.original_name || 'file'}"`);
    fs.createReadStream(fp).pipe(res);
  } catch (err) {
    console.error('Get attachment file error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

