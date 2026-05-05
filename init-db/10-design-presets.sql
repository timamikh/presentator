-- User-saved design briefs reusable across jobs (e.g. "corporate", "playful").
-- brief_json stores the structured form (palette, typography, layout, tone, etc.)
-- exactly as the frontend produces it; the aggregator runs at job-creation time.

CREATE TABLE IF NOT EXISTS presentator.design_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES presentator.users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    brief_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_design_presets_user
    ON presentator.design_presets(user_id);
