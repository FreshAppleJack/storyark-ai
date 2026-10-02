-- Compatibility marker for databases that reached version 10 before retrieval
-- task metadata was added. The conditional ALTER TABLE is applied by the Rust
-- migration transaction because newer version-10 databases may already have
-- the column from the corrected 0010 migration.
SELECT 1;
