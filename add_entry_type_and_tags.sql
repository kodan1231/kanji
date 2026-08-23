ALTER TABLE kanji ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'kanji';

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE kanji_tags (
  kanji_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (kanji_id, tag_id),
  FOREIGN KEY (kanji_id) REFERENCES kanji(id),
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE INDEX idx_kanji_tags_tag_id ON kanji_tags(tag_id);