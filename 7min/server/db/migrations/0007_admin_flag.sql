-- Add admin flag to users table
-- Admin users can manage other users (view, update passwords)

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Set carl@rytterfalk.com as admin
UPDATE users SET is_admin = 1 WHERE email = 'carl@rytterfalk.com';

