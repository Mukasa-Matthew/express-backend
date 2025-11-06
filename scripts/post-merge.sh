#!/bin/bash

# Git post-merge hook
# This script runs automatically after git pull/merge
# It ensures database migrations are applied

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

# Only run if we're in a git repository
if [ ! -d ".git" ]; then
    exit 0
fi

# Check if package.json exists (we're in the backend directory)
if [ ! -f "package.json" ]; then
    exit 0
fi

echo "🔄 Git pull detected, running database migrations..."

# Run migrations
if command -v npm &> /dev/null; then
    if [ -f "node_modules/.bin/ts-node" ] || [ -d "node_modules/ts-node" ]; then
        npx ts-node src/database/migrations.ts || echo "⚠️  Migration failed, but continuing..."
    else
        # Try to run compiled version
        if [ -f "dist/database/migrations.js" ]; then
            node dist/database/migrations.js || echo "⚠️  Migration failed, but continuing..."
        fi
    fi
fi

exit 0







