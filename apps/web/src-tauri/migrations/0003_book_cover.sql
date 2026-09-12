-- 0003: bookshelf card accent color, chosen once at creation from a fixed
-- palette. Empty string means "no accent" (the card falls back to its
-- neutral cover). Additive only; the released 0001/0002 files stay untouched.
ALTER TABLE books ADD COLUMN cover_color TEXT NOT NULL DEFAULT '';
