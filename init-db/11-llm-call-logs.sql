-- LLM observability: raw storage of every LLM interaction across all stages.
--
-- Why a dedicated table (instead of just job_pipeline_steps.llm_request /
-- llm_response):
--   • One step (attempt) may generate several LLM calls (e.g. retries inside
--     a single n8n node). We need 1 row per real call to compute accurate
--     token totals and per-call latency.
--   • Per-stage step rows are tightly coupled to the staged pipeline; this
--     table is the source of truth for the /metrics dashboard and stays
--     useful even if we add new stages.
--   • Tokens / latency / model / finish_reason are first-class columns so the
--     metrics queries don't have to scan JSONB on the hot path.
--
-- Tokens are always counted locally (cl100k_base via gpt-tokenizer) — provider
-- usage is unreliable for OpenAI-compatible gateways. We still keep
-- raw_response.usage if present, but the analytical columns are computed
-- in api-service before INSERT.

CREATE TABLE IF NOT EXISTS presentator.llm_call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES presentator.jobs(id) ON DELETE CASCADE,
    step_id UUID REFERENCES presentator.job_pipeline_steps(id) ON DELETE SET NULL,
    user_id UUID REFERENCES presentator.users(id) ON DELETE SET NULL,
    stage VARCHAR(30) NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    model TEXT,
    provider TEXT,
    system_prompt TEXT,
    user_message TEXT,
    raw_request JSONB,
    raw_response JSONB,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER GENERATED ALWAYS AS (
        COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)
    ) STORED,
    tokens_source VARCHAR(20) NOT NULL DEFAULT 'estimated'
        CHECK (tokens_source IN ('estimated', 'provider', 'mixed')),
    finish_reason TEXT,
    latency_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_call_logs_job ON presentator.llm_call_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_user ON presentator.llm_call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_created_at ON presentator.llm_call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_stage ON presentator.llm_call_logs(stage);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_step ON presentator.llm_call_logs(step_id);

-- Idempotency for n8n callbacks: a given (job_id, step_id, stage) should be
-- logged exactly once even if the workflow retries the save-step call.
-- step_id may be NULL for "free" LLM calls outside the staged pipeline (e.g.
-- extractor summarization in the future), so the partial unique index only
-- applies when step_id is present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_call_logs_step
    ON presentator.llm_call_logs(step_id)
    WHERE step_id IS NOT NULL;
