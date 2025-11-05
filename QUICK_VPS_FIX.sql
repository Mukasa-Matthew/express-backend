-- Quick fix for VPS migration issues
-- Run this directly on your VPS database to mark all migrations as applied

-- Create the migrations table if it doesn't exist
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64),
  execution_time_ms INTEGER
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(migration_name);

-- Mark all migrations as applied (based on your migration files)
INSERT INTO schema_migrations (migration_name, checksum, execution_time_ms)
VALUES 
  ('0001-initial-schema', 'manual-fix', 0),
  ('0002-add-hostel-fields', 'manual-fix', 0),
  ('0003-create-hostel-images', 'manual-fix', 0),
  ('0004-add-missing-columns', 'manual-fix', 0),
  ('0005-create-semester-tables', 'manual-fix', 0),
  ('0006-create-inventory-items', 'manual-fix', 0),
  ('0007-add-rooms-missing-columns', 'manual-fix', 0),
  ('0008-add-custodians-missing-columns', 'manual-fix', 0),
  ('0009-add-payments-missing-columns', 'manual-fix', 0),
  ('0010-add-student-room-assignments-missing-columns', 'manual-fix', 0),
  ('0011-create-student-profiles', 'manual-fix', 0)
ON CONFLICT (migration_name) DO NOTHING;

-- Verify the fix
SELECT migration_name, applied_at FROM schema_migrations ORDER BY applied_at;

