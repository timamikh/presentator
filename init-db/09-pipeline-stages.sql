-- Staged pipeline (v2): generation is split into Planning → Design → Layout
-- with optional user review between stages and a Refinement stage afterwards.
-- pipeline_version=1 keeps legacy single-pass jobs working unchanged.
-- pipeline_version=2 enables the staged flow.

ALTER TABLE presentator.jobs
    ADD COLUMN IF NOT EXISTS pipeline_version INTEGER NOT NULL DEFAULT 2;

-- Existing jobs (created before this migration) belong to the legacy v1 pipeline.
-- We only flip the default; rows already present must be marked explicitly so
-- they keep going through the single-pass workflow.
UPDATE presentator.jobs
   SET pipeline_version = 1
 WHERE pipeline_version IS NULL OR pipeline_version = 0;

ALTER TABLE presentator.jobs
    ADD COLUMN IF NOT EXISTS current_stage VARCHAR(30);

ALTER TABLE presentator.jobs
    ADD COLUMN IF NOT EXISTS planning_result JSONB;

ALTER TABLE presentator.jobs
    ADD COLUMN IF NOT EXISTS design_brief JSONB;

ALTER TABLE presentator.jobs
    ADD COLUMN IF NOT EXISTS design_input JSONB;

-- jobs.status was originally VARCHAR(20) (legacy single-pass pipeline), but
-- staged statuses like 'awaiting_planning_review' / 'processing_planning' are
-- longer than 20 chars and cause `value too long for type character varying(20)`
-- on n8n callbacks. We widen the column before swapping the CHECK constraint.
ALTER TABLE presentator.jobs
    ALTER COLUMN status TYPE VARCHAR(40);

-- Extend jobs.status check constraint to support the new staged statuses.
-- We drop the old constraint (added in 02-users-table.sql) and add a wider one.
DO $$
DECLARE
    cons TEXT;
BEGIN
    SELECT conname INTO cons
      FROM pg_constraint
     WHERE conrelid = 'presentator.jobs'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%IN%';
    IF cons IS NOT NULL THEN
        EXECUTE format('ALTER TABLE presentator.jobs DROP CONSTRAINT %I', cons);
    END IF;
END $$;

ALTER TABLE presentator.jobs
    ADD CONSTRAINT jobs_status_check
    CHECK (status IN (
        'pending',
        'processing',
        'processing_planning',
        'processing_design',
        'processing_layout',
        'processing_refine',
        'awaiting_planning_review',
        'awaiting_design_review',
        'done',
        'error'
    ));

-- Per-stage execution log. Each (job_id, stage) gets a new row per attempt so
-- refinement / regeneration history stays visible. UNIQUE keeps idempotency
-- and lets the UI pick "latest attempt" deterministically.
CREATE TABLE IF NOT EXISTS presentator.job_pipeline_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES presentator.jobs(id) ON DELETE CASCADE,
    stage VARCHAR(30) NOT NULL
        CHECK (stage IN ('planning', 'design', 'layout', 'refine_layout', 'render')),
    attempt INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'error')),
    input JSONB,
    output JSONB,
    llm_request JSONB,
    llm_response JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, stage, attempt)
);

CREATE INDEX IF NOT EXISTS idx_job_pipeline_steps_job
    ON presentator.job_pipeline_steps(job_id);

CREATE INDEX IF NOT EXISTS idx_job_pipeline_steps_job_stage
    ON presentator.job_pipeline_steps(job_id, stage);
