-- sqlc registers FTS5 tables with their declared columns only. These add the hidden columns so MATCH and bm25 type-check.
-- Read by sqlc only; never applied to a database.
ALTER TABLE foods_fts ADD COLUMN foods_fts TEXT;
ALTER TABLE foods_fts ADD COLUMN rank REAL;
ALTER TABLE catalog_fts ADD COLUMN catalog_fts TEXT;
ALTER TABLE catalog_fts ADD COLUMN rank REAL;
ALTER TABLE foods_trgm ADD COLUMN foods_trgm TEXT;
ALTER TABLE foods_trgm ADD COLUMN rank REAL;
ALTER TABLE catalog_trgm ADD COLUMN catalog_trgm TEXT;
ALTER TABLE catalog_trgm ADD COLUMN rank REAL;
ALTER TABLE reference_fts ADD COLUMN reference_fts TEXT;
ALTER TABLE reference_fts ADD COLUMN rank REAL;
