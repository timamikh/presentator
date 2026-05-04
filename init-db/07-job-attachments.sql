-- Link table between jobs and attachments + per-job description snapshot.
-- The snapshot decouples the job context from later edits in the user's library:
-- once a job is created, modifying the library description does not affect this job.

CREATE TABLE IF NOT EXISTS presentator.job_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES presentator.jobs(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES presentator.attachments(id) ON DELETE RESTRICT,
    description_snapshot TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_job_attachments_job
    ON presentator.job_attachments(job_id);

CREATE INDEX IF NOT EXISTS idx_job_attachments_attachment
    ON presentator.job_attachments(attachment_id);
