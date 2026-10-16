ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
CREATE INDEX users_password_change_idx ON users(must_change_password) WHERE must_change_password = 1;
