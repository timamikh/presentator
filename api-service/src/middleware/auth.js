const jwt = require('jsonwebtoken');
const config = require('../config');

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function internalAuth(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== config.internalApiKey) {
    return res.status(403).json({ error: 'Forbidden: invalid internal key' });
  }
  next();
}

module.exports = { authRequired, internalAuth };
