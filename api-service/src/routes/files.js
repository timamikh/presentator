const { Router } = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const config = require('../config');
const { query } = require('../db');

const router = Router();

function resolveUser(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret);
      return { id: payload.id, email: payload.email };
    } catch {}
  }
  const token = req.query.token;
  if (token && typeof token === 'string') {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      return { id: payload.id, email: payload.email };
    } catch {}
  }
  return null;
}

router.get('/attachment/:id', async (req, res) => {
  try {
    const user = resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const result = await query(
      `SELECT file_path, original_name, mime_type
       FROM presentator.attachments
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { file_path, original_name, mime_type } = result.rows[0];
    if (!fs.existsSync(file_path)) {
      return res.status(404).json({ error: 'File missing on disk' });
    }

    res.setHeader('Content-Type', mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(original_name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return fs.createReadStream(file_path).pipe(res);
  } catch (err) {
    console.error('Serve attachment file error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
