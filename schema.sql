-- ユーザー
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- セッション
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 漢字マスタ
CREATE TABLE kanji (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character TEXT NOT NULL,
  reading_on TEXT,
  reading_kun TEXT,
  meaning TEXT
);

-- タグ
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

-- 問題（読み問題のみ。typeとchoicesは廃止済み）
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanji_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'reading',
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  accepted_answers TEXT, -- JSON配列文字列。正解として許容する読みのバリエーション
  FOREIGN KEY (kanji_id) REFERENCES kanji(id)
);

-- 回答履歴
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  is_correct INTEGER NOT NULL, -- 0 or 1
  answered_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- インデックス
CREATE INDEX idx_questions_kanji_id ON questions(kanji_id);
CREATE INDEX idx_attempts_user_id ON attempts(user_id);
CREATE INDEX idx_attempts_question_id ON attempts(question_id);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_kanji_tags_tag_id ON kanji_tags(tag_id);