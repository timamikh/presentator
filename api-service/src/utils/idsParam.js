// Shared parser for the `?ids=…` query parameter used by batch-lookup
// endpoints (GET /api/attachments/by-ids today; more will follow as
// `applyDraft` and similar restore-from-history flows need to fetch
// detached resources by id).

// Accepts both v4 (`-4xxx-`) and a few outliers (e.g. `gen_random_uuid()`
// occasionally emits `-Nxxx-` where N != 4). We're not validating
// strictly, just keeping out obviously bad input that would otherwise
// land in a SQL `IN (...)` clause.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_MAX_IDS = 100;

/**
 * @param {string|string[]|null|undefined} raw — value of `req.query.ids`,
 *        either a comma-separated string or an array (Express duplicates
 *        keys into arrays when the same param appears multiple times).
 * @param {Object} [options]
 * @param {number} [options.maxIds=100] — hard cap on output length to
 *        keep the SQL params count bounded.
 * @returns {string[]} de-duplicated, UUID-validated list (possibly empty).
 */
function parseIdsParam(raw, options = {}) {
  const maxIds =
    Number.isFinite(options.maxIds) && options.maxIds > 0
      ? options.maxIds
      : DEFAULT_MAX_IDS;

  let items = [];
  if (raw == null) return items;

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    items = raw.split(',');
  } else {
    return [];
  }

  const seen = new Set();
  const out = [];
  for (const value of items) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!UUID_RE.test(trimmed)) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
    if (out.length >= maxIds) break;
  }
  return out;
}

module.exports = {
  parseIdsParam,
  UUID_RE,
  DEFAULT_MAX_IDS,
};
