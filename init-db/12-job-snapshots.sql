-- Job versioning: every meaningful state change of a job gets a row in
-- job_snapshots so the user can browse history and roll back.
--
-- Sources of snapshots:
--   • auto: created by services/pipeline.completeStage after each successful
--           stage (planning / design / layout / refine_layout).
--   • manual: created by the user via POST /api/jobs/:id/snapshots — used to
--             tag "good" states before risky edits.
--
-- A snapshot is a full, self-contained copy of the job's user-visible state
-- (prompt, design_input, planning_result, design_brief, slide_data, ...).
-- Restoring a snapshot is a single UPDATE of these columns on jobs + a new
-- snapshot row marked as "restore-point" so the audit log stays linear.

CREATE TABLE IF NOT EXISTS presentator.job_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES presentator.jobs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'auto'
        CHECK (kind IN ('auto', 'manual', 'restore')),
    label TEXT,
    stage VARCHAR(30),
    status VARCHAR(40),
    current_stage VARCHAR(30),
    prompt TEXT,
    slide_count INTEGER,
    slide_prompts JSONB,
    presentation_settings JSONB,
    system_prompt TEXT,
    design_input JSONB,
    planning_result JSONB,
    design_brief JSONB,
    slide_data JSONB,
    result_paths JSONB,
    created_by_step_id UUID REFERENCES presentator.job_pipeline_steps(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES presentator.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, version)
);

CREATE INDEX IF NOT EXISTS idx_job_snapshots_job ON presentator.job_snapshots(job_id);
CREATE INDEX IF NOT EXISTS idx_job_snapshots_created_at ON presentator.job_snapshots(created_at DESC);
