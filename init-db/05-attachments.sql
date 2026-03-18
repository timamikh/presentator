CREATE TABLE IF NOT EXISTS presentator.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES presentator.users(id),
    original_name TEXT NOT NULL,
    mime_type TEXT,
    file_size BIGINT,
    prompt TEXT,
    file_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON presentator.attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_mime_type ON presentator.attachments(mime_type);

