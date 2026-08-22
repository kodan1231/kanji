-- ユーザー
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 漢字マスタ
CREATE TABLE kanji (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character TEXT NOT NULL,
  level INTEGER NOT NULL,
  reading_on TEXT,
  reading_kun TEXT,
  radical TEXT,
  stroke_count INTEGER,
  meaning TEXT
);

-- 問題
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanji_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'reading' | 'writing' | 'radical' など
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  choices TEXT, -- 選択式の場合、JSON配列文字列。記述式はNULL
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

-- よく使う検索・集計を高速化するためのインデックス
CREATE INDEX idx_kanji_level ON kanji(level);
CREATE INDEX idx_questions_kanji_id ON questions(kanji_id);
CREATE INDEX idx_attempts_user_id ON attempts(user_id);
CREATE INDEX idx_attempts_question_id ON attempts(question_id);
