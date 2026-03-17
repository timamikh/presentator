CREATE TABLE IF NOT EXISTS presentator.job_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES presentator.jobs(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    slide_data JSONB,
    result_paths JSONB,
    llm_request JSONB,
    llm_response JSONB,
    user_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(job_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_job_revisions_job_id ON presentator.job_revisions(job_id);
