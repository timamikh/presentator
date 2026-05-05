-- Extraction status fields for the attachment library.
-- extractor-service (Python/FastAPI) walks pending rows asynchronously and
-- writes back extracted_text / content_summary via the api-service internal
-- callback. Status is idempotent: only 'pending' or 'failed' rows are reprocessed
-- (forced re-extraction passes ?force=true).

ALTER TABLE presentator.attachments
    ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(20)
        NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'processing', 'done', 'failed', 'skipped'));

ALTER TABLE presentator.attachments
    ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

ALTER TABLE presentator.attachments
    ADD COLUMN IF NOT EXISTS extraction_error TEXT;

CREATE INDEX IF NOT EXISTS idx_attachments_extraction_status
    ON presentator.attachments(extraction_status)
    WHERE extraction_status IN ('pending', 'failed');
