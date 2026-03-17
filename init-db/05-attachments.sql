CREATE TABLE IF NOT EXISTS presentator.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES presentator.users(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    mime_type VARCHAR(100),
    file_size INTEGER,
    prompt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON presentator.attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_mime_type ON presentator.attachments(mime_type);

CREATE TABLE IF NOT EXISTS presentator.job_attachments (
    job_id UUID NOT NULL REFERENCES presentator.jobs(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES presentator.attachments(id) ON DELETE CASCADE,
    prompt_snapshot TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_job_attachments_job_id ON presentator.job_attachments(job_id);
