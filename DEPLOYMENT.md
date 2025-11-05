# Deployment Guide - Automatic Database Migration System

This guide explains how to use the automatic database migration system when deploying to your VPS.

## Overview

The migration system automatically:
- ✅ Tracks which migrations have been applied
- ✅ Applies only new migrations (never runs the same migration twice)
- ✅ Runs safely on startup (won't disrupt existing database)
- ✅ Can be triggered manually or automatically after `git pull`

## How It Works

1. **Migration Tracking**: A `schema_migrations` table tracks all applied migrations
2. **Automatic Detection**: On startup, the system checks for new migrations
3. **Safe Execution**: Only unapplied migrations are run
4. **Idempotent**: Can be run multiple times safely

## Migration Files

Migrations are stored in `backend/src/database/migrations/` and should:
- Be named with a numeric prefix: `0001-description.ts`, `0002-description.ts`, etc.
- Export a default async function that performs the migration
- Use `ADD COLUMN IF NOT EXISTS` for backward compatibility

Example migration:
```typescript
import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS new_field VARCHAR(255)
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

## Deployment Options

### Option 1: Automatic on Startup (Recommended)

Migrations run automatically when the backend starts. This means:
- Just restart your backend after `git pull`
- No manual steps required
- Safe and automatic

```bash
# On your VPS
cd /path/to/backend
git pull
npm install
npm run build
# Restart your backend (PM2, systemd, etc.)
pm2 restart backend  # or systemctl restart backend
```

### Option 2: Manual Migration Script

Run migrations manually before restarting:

```bash
# On your VPS
cd /path/to/backend
git pull
npm install
npm run migrate
npm run build
# Restart backend
```

### Option 3: Full Deployment Script

Use the deployment script for a complete deployment:

```bash
# On your VPS
cd /path/to/backend
git pull
bash scripts/deploy.sh
# This will:
# - Install dependencies
# - Build TypeScript
# - Run migrations
# - Ready to restart
```

### Option 4: Git Hook (Advanced)

Set up a git post-merge hook to run migrations automatically after `git pull`:

```bash
# On your VPS
cd /path/to/backend
chmod +x scripts/post-merge.sh
ln -s ../../scripts/post-merge.sh .git/hooks/post-merge
```

Now migrations will run automatically after every `git pull`!

## VPS Deployment Workflow

### Initial Setup

1. Clone repository on VPS
2. Install dependencies: `npm install`
3. Create `.env` file with your configuration (see CORS Configuration below)
4. Build: `npm run build`
5. Start backend - migrations will run automatically on first startup

#### CORS Configuration for Production

To allow your frontend to communicate with the backend, configure the following environment variables in your `.env` file:

```bash
# Single frontend URL
FRONTEND_URL=https://yourdomain.com

# OR multiple frontend URLs (comma-separated)
FRONTEND_URLS=https://yourdomain.com,https://www.yourdomain.com,https://app.yourdomain.com

# Set production environment
NODE_ENV=production
```

**Important Notes:**
- The backend allows requests from the specified frontend URL(s) only
- In development, localhost origins are allowed automatically
- Make sure to include the protocol (http:// or https://) in the URLs
- If you have both `www` and non-`www` versions of your site, include both in `FRONTEND_URLS`
- The backend supports credentials (cookies, authorization headers) for authenticated requests

#### Reverse Proxy Configuration (Nginx Example)

If you're using Nginx as a reverse proxy, make sure to pass the correct headers:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Note:** When using a reverse proxy, the `FRONTEND_URL` should match the actual frontend domain, not the proxy domain. The backend will see the original origin from the `Origin` header.

### Daily Updates

```bash
# Simple workflow
cd /path/to/backend
git pull                    # Pull latest changes
npm install                 # Update dependencies (if package.json changed)
npm run build              # Rebuild TypeScript
pm2 restart backend        # Restart - migrations run automatically
```

Or use the deployment script:

```bash
cd /path/to/backend
git pull
bash scripts/deploy.sh
pm2 restart backend
```

## Creating New Migrations

When you add a new feature that requires database changes:

1. Create a new migration file in `backend/src/database/migrations/`
2. Name it with the next sequential number: `0004-add-feature.ts`
3. Export a default function that performs the migration
4. Use `IF NOT EXISTS` for backward compatibility
5. Commit and push to GitHub

Example:
```typescript
// backend/src/database/migrations/0004-add-feature.ts
import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS new_feature (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await client.query('COMMIT');
    console.log('✅ New feature migration completed');
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

## Troubleshooting

### Migration fails on startup
- Check the error message in logs
- Fix the migration file
- Restart the backend

### Migration already applied but still running
- Check `schema_migrations` table
- Migration name might not match - ensure consistent naming

### Need to rollback a migration
- Manually remove the migration record from `schema_migrations` table
- Or create a new migration that undoes the changes

## Best Practices

1. ✅ Always use `IF NOT EXISTS` for tables/columns
2. ✅ Use transactions (`BEGIN`/`COMMIT`/`ROLLBACK`)
3. ✅ Test migrations on a development database first
4. ✅ Keep migrations small and focused
5. ✅ Never modify existing migration files (create new ones instead)
6. ✅ Use descriptive migration names

## Migration Commands

```bash
# Run migrations manually
npm run migrate

# Run database sync (includes build)
npm run sync-db

# Full deployment
npm run deploy
```

## Notes

- Migrations run automatically on backend startup
- They're idempotent - safe to run multiple times
- Only new migrations are applied
- Existing data is never deleted or modified
- The system uses `ADD COLUMN IF NOT EXISTS` to avoid conflicts




