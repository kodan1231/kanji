ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1 WHERE username = 'admin';