// Analytical queries for the /metrics dashboard. SQL lives here so routes can
// stay thin and so the projection helpers (buildSummaryRow / buildByStageRows
// / ...) can be unit-tested without touching the DB.
//
// Every query is parameterized by user_id so users can never see each other's
// metrics. /metrics/* routes always pass req.user.id into deps.

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseDaysParam(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  if (n < 1) return 1;
  if (n > 365) return 365;
  return Math.floor(n);
}

function isoDay(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Postgres date type sometimes comes back as a Date; try to coerce.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

function buildSummaryRow(raw = {}) {
  return {
    total_calls: toInt(raw.total_calls),
    total_prompt_tokens: toInt(raw.total_prompt_tokens),
    total_completion_tokens: toInt(raw.total_completion_tokens),
    total_tokens: toInt(raw.total_tokens),
    avg_latency_ms: toInt(raw.avg_latency_ms),
    total_jobs: toInt(raw.total_jobs),
    error_calls: toInt(raw.error_calls),
  };
}

function buildByStageRows(rows = []) {
  return rows.map((r) => ({
    stage: r.stage,
    total_calls: toInt(r.total_calls),
    total_tokens: toInt(r.total_tokens),
    avg_latency_ms: toInt(r.avg_latency_ms),
    prompt_tokens: toInt(r.prompt_tokens),
    completion_tokens: toInt(r.completion_tokens),
  }));
}

function buildByDayRows(rows = []) {
  return rows.map((r) => ({
    day: isoDay(r.day),
    total_calls: toInt(r.total_calls),
    total_tokens: toInt(r.total_tokens),
    prompt_tokens: toInt(r.prompt_tokens),
    completion_tokens: toInt(r.completion_tokens),
  }));
}

function buildByModelRows(rows = []) {
  return rows.map((r) => ({
    model: r.model || 'unknown',
    total_calls: toInt(r.total_calls),
    total_tokens: toInt(r.total_tokens),
    avg_latency_ms: toInt(r.avg_latency_ms),
  }));
}

const SUMMARY_SQL = `
  SELECT
    COUNT(*)::int                                AS total_calls,
    COALESCE(SUM(prompt_tokens), 0)::int         AS total_prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)::int     AS total_completion_tokens,
    COALESCE(SUM(total_tokens), 0)::int          AS total_tokens,
    COALESCE(AVG(latency_ms), 0)                 AS avg_latency_ms,
    COUNT(DISTINCT job_id)::int                  AS total_jobs,
    SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END)::int
                                                AS error_calls
  FROM presentator.llm_call_logs
  WHERE user_id = $1
    AND created_at >= now() - ($2::text || ' days')::interval
`;

const BY_STAGE_SQL = `
  SELECT stage,
         COUNT(*)::int                            AS total_calls,
         COALESCE(SUM(total_tokens), 0)::int      AS total_tokens,
         COALESCE(SUM(prompt_tokens), 0)::int     AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
         COALESCE(AVG(latency_ms), 0)             AS avg_latency_ms
    FROM presentator.llm_call_logs
   WHERE user_id = $1
     AND created_at >= now() - ($2::text || ' days')::interval
   GROUP BY stage
   ORDER BY stage
`;

const BY_DAY_SQL = `
  SELECT date_trunc('day', created_at)::date AS day,
         COUNT(*)::int                            AS total_calls,
         COALESCE(SUM(total_tokens), 0)::int      AS total_tokens,
         COALESCE(SUM(prompt_tokens), 0)::int     AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens
    FROM presentator.llm_call_logs
   WHERE user_id = $1
     AND created_at >= now() - ($2::text || ' days')::interval
   GROUP BY day
   ORDER BY day
`;

const BY_MODEL_SQL = `
  SELECT model,
         COUNT(*)::int                          AS total_calls,
         COALESCE(SUM(total_tokens), 0)::int    AS total_tokens,
         COALESCE(AVG(latency_ms), 0)           AS avg_latency_ms
    FROM presentator.llm_call_logs
   WHERE user_id = $1
     AND created_at >= now() - ($2::text || ' days')::interval
   GROUP BY model
   ORDER BY total_tokens DESC
`;

const RECENT_CALLS_SQL = `
  SELECT id, job_id, step_id, stage, attempt, model,
         prompt_tokens, completion_tokens, total_tokens, tokens_source,
         finish_reason, latency_ms, error_message, created_at
    FROM presentator.llm_call_logs
   WHERE user_id = $1
   ORDER BY created_at DESC
   LIMIT $2
`;

async function getSummary({ userId, days }, { query }) {
  const res = await query(SUMMARY_SQL, [userId, String(days)]);
  return buildSummaryRow(res.rows?.[0] || {});
}

async function getByStage({ userId, days }, { query }) {
  const res = await query(BY_STAGE_SQL, [userId, String(days)]);
  return buildByStageRows(res.rows || []);
}

async function getByDay({ userId, days }, { query }) {
  const res = await query(BY_DAY_SQL, [userId, String(days)]);
  return buildByDayRows(res.rows || []);
}

async function getByModel({ userId, days }, { query }) {
  const res = await query(BY_MODEL_SQL, [userId, String(days)]);
  return buildByModelRows(res.rows || []);
}

async function getRecentCalls({ userId, limit = 50 }, { query }) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 50));
  const res = await query(RECENT_CALLS_SQL, [userId, lim]);
  return (res.rows || []).map((r) => ({
    id: r.id,
    job_id: r.job_id,
    step_id: r.step_id,
    stage: r.stage,
    attempt: toInt(r.attempt),
    model: r.model || 'unknown',
    prompt_tokens: toInt(r.prompt_tokens),
    completion_tokens: toInt(r.completion_tokens),
    total_tokens: toInt(r.total_tokens),
    tokens_source: r.tokens_source,
    finish_reason: r.finish_reason,
    latency_ms: toInt(r.latency_ms),
    error_message: r.error_message,
    created_at: r.created_at,
  }));
}

const GET_CALL_SQL = `
  SELECT *
    FROM presentator.llm_call_logs
   WHERE id = $1 AND user_id = $2
`;

async function getCallById({ userId, id }, { query }) {
  const res = await query(GET_CALL_SQL, [id, userId]);
  return res.rows?.[0] || null;
}

module.exports = {
  parseDaysParam,
  buildSummaryRow,
  buildByStageRows,
  buildByDayRows,
  buildByModelRows,
  getSummary,
  getByStage,
  getByDay,
  getByModel,
  getRecentCalls,
  getCallById,
};
