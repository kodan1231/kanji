DROP INDEX IF EXISTS idx_kanji_level;
ALTER TABLE kanji DROP COLUMN level;
ALTER TABLE kanji DROP COLUMN radical;
ALTER TABLE kanji DROP COLUMN stroke_count;