-- Draft form state on /create. Lets the user save partially-filled forms
-- before submitting a real job, switch between drafts, and roll back to a
-- previous version of the same draft.
--
-- Drafts are intentionally decoupled from `jobs`:
--   • A draft is never executed by the pipeline — the user explicitly
--     "applies" it (creates a job from it) via the existing POST /api/jobs.
--   • A draft can have many versions (history). Each save bumps `version`.
--
-- Files attached to a draft are referenced by attachment_id (library refs);
-- one-shot uploads cannot be drafted (they live in browser memory only).

CREATE TABLE IF NOT EXISTS presentator.job_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES presentator.users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    prompt TEXT,
    slide_count INTEGER,
    slide_prompts JSONB,
    presentation_settings JSONB,
    system_prompt TEXT,
    design_input JSONB,
    design_brief JSONB,
    attachments JSONB,
    pipeline_version INTEGER NOT NULL DEFAULT 2,
    head_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_drafts_user ON presentator.job_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_job_drafts_updated_at ON presentator.job_drafts(updated_at DESC);

-- Per-draft version history. Every PUT bumps `head_version` on the parent and
-- inserts a row here. Restore = copy a row's contents back to the parent and
-- bump head_version again (with kind='restore').
CREATE TABLE IF NOT EXISTS presentator.job_draft_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id UUID NOT NULL REFERENCES presentator.job_drafts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'edit'
        CHECK (kind IN ('edit', 'restore', 'initial')),
    label TEXT,
    prompt TEXT,
    slide_count INTEGER,
    slide_prompts JSONB,
    presentation_settings JSONB,
    system_prompt TEXT,
    design_input JSONB,
    design_brief JSONB,
    attachments JSONB,
    pipeline_version INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (draft_id, version)
);

CREATE INDEX IF NOT EXISTS idx_job_draft_versions_draft
    ON presentator.job_draft_versions(draft_id);
