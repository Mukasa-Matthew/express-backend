#!/bin/bash

# Database sync script
# This script can be run manually or automatically to sync database changes

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

echo -e "${BLUE}🔄 Syncing database changes...${NC}"

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found. Are you in the backend directory?${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found. Installing dependencies...${NC}"
    npm install
fi

# Build if dist doesn't exist or is outdated
if [ ! -d "dist" ] || [ "src" -nt "dist" ]; then
    echo -e "${GREEN}🔨 Building TypeScript...${NC}"
    npm run build
fi

# Run migrations
echo -e "${GREEN}🔄 Running database migrations...${NC}"
if [ -f "node_modules/.bin/ts-node" ] || [ -d "node_modules/ts-node" ]; then
    npx ts-node -r tsconfig-paths/register src/database/migrations.ts
else
    if [ -f "dist/database/migrations.js" ]; then
        node dist/database/migrations.js
    else
        echo -e "${RED}❌ Error: Cannot find ts-node or compiled migrations${NC}"
        echo -e "${YELLOW}💡 Try running: npm install && npm run build${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Database sync completed!${NC}"




