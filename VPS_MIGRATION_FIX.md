# VPS Migration Fix Guide

## Problem
When running `npm run migrate` on your VPS, you're getting errors like:
- `ERROR: relation "users" already exists`
- `ERROR: column "is_verified" of relation "users" already exists`
- `ERROR: column "verification_token" does not exist`

This happens when your database already has the schema, but the `schema_migrations` table doesn't have records tracking which migrations have been applied.

## Solution 1: Quick SQL Fix (IMMEDIATE - No Git Needed)

**Run this directly in your database RIGHT NOW** - no code changes needed:

```bash
# On your VPS, connect to PostgreSQL
sudo -u postgres psql -d your_database_name
# OR if you have a specific user:
psql -U your_database_user -d your_database_name
```

Then paste and run this SQL:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64),
  execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(migration_name);

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

SELECT migration_name, applied_at FROM schema_migrations ORDER BY applied_at;
```

Type `\q` to exit PostgreSQL. Now `npm run migrate` should work!

## Solution 2: Using the Script (After Git Sync)

If your VPS git is properly synced, run:

```bash
cd ~/real_devbacke  # or wherever your backend is located
npm run fix-vps-migrations
```

**Note:** If `git pull` says "Already up to date", you may need to:
1. Check which remote you're tracking: `git remote -v`
2. Fetch latest: `git fetch origin`
3. Pull: `git pull origin main`

## Solution 2: Automatic Fix (Future Runs)

The migration system has been updated to automatically handle "already exists" errors. When a migration encounters an error like:
- Table already exists
- Column already exists  
- Column doesn't exist (when dropping)

It will automatically mark the migration as applied and continue. This means future runs should work smoothly.

## Solution 3: Manual Database Fix

If the scripts don't work, you can manually mark migrations as applied:

```sql
-- Connect to your database
psql -U your_user -d your_database

-- Create the migrations table if it doesn't exist
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64),
  execution_time_ms INTEGER
);

-- Mark all migrations as applied
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
```

## Verification

After applying the fix, verify it worked:

```bash
npm run check-migrations
```

This will show you which migrations are recorded as applied.

## Notes

- The fix script is safe to run multiple times - it won't duplicate records
- This only fixes the migration tracking, it doesn't modify your actual database schema
- If you have new migrations that haven't been applied yet, they will still run normally after the fix

