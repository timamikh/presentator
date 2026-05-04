-- User attachment library: persistent, reusable across multiple jobs.
-- ref is a short stable identifier surfaced to the LLM (used in {{attachment:<ref>}} tokens).
-- extracted_text and content_summary are reserved for future preprocessing pipelines (RAG/document parsing).

CREATE TABLE IF NOT EXISTS presentator.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES presentator.users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES presentator.folders(id) ON DELETE SET NULL,
    ref VARCHAR(32) UNIQUE NOT NULL,
    original_name VARCHAR(512) NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(255),
    file_size BIGINT,
    kind VARCHAR(20) NOT NULL DEFAULT 'other'
        CHECK (kind IN ('image', 'document', 'other')),
    description TEXT,
    extracted_text TEXT,
    content_summary TEXT,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_user_folder
    ON presentator.attachments(user_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_attachments_ref
    ON presentator.attachments(ref);
