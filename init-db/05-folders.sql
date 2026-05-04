-- Folders for the user attachment library (tree structure of arbitrary depth).
-- Folders are purely logical: physical files live in a flat /data/library/<user_id>/ layout
-- so moving an attachment between folders is a single UPDATE without I/O.

CREATE TABLE IF NOT EXISTS presentator.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES presentator.users(id) ON DELETE CASCADE,
    parent_folder_id UUID REFERENCES presentator.folders(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique sibling names within the same parent (root level uses NULL parent;
-- a partial unique index handles NULL because UNIQUE on NULL is not enforced).
CREATE UNIQUE INDEX IF NOT EXISTS uq_folders_user_parent_name
    ON presentator.folders(user_id, parent_folder_id, name)
    WHERE parent_folder_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_folders_user_root_name
    ON presentator.folders(user_id, name)
    WHERE parent_folder_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_folders_user_parent
    ON presentator.folders(user_id, parent_folder_id);
