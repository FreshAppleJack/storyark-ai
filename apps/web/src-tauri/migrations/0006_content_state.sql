-- 0006: preserve whether chapter content is safe to edit independently of the
-- record lock. Unknown Tiptap marks and attributes remain available in a
-- read-only or pending-migration state instead of being discarded.
ALTER TABLE chapters ADD COLUMN content_state TEXT NOT NULL DEFAULT 'read-only'
    CHECK (content_state IN ('editable', 'read-only', 'pending-migration'));

UPDATE chapters
SET content_state = 'editable'
WHERE content_format = 'tiptap-json' AND content_version = 1;
