# Deployment Scripts

This directory contains scripts for deploying and managing the backend on your VPS.

## Scripts

### `deploy.sh`
Full deployment script that:
- Installs/updates dependencies
- Builds TypeScript
- Runs database migrations
- Prepares for restart

**Usage:**
```bash
cd backend
bash scripts/deploy.sh
```

### `sync-database.sh`
Syncs database changes by:
- Building TypeScript (if needed)
- Running migrations

**Usage:**
```bash
cd backend
bash scripts/sync-database.sh
```

### `post-merge.sh`
Git hook script that runs automatically after `git pull` or `git merge`.

**Setup:**
```bash
cd backend
chmod +x scripts/post-merge.sh
ln -s ../../scripts/post-merge.sh .git/hooks/post-merge
```

## Quick VPS Deployment

After `git pull` on your VPS:

```bash
cd /path/to/backend
git pull
bash scripts/deploy.sh
pm2 restart backend  # or systemctl restart backend
```

That's it! Migrations will run automatically.




