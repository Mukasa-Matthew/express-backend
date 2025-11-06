#!/bin/bash

# Deployment script for VPS
# This script should be run after git pull to sync database changes

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found. Are you in the backend directory?${NC}"
    exit 1
fi

echo -e "${GREEN}📦 Installing/updating dependencies...${NC}"
npm install --production

echo -e "${GREEN}🔨 Building TypeScript...${NC}"
npm run build

echo -e "${GREEN}🔄 Running database migrations...${NC}"
# Run migrations using ts-node (for development) or compiled JS (for production)
if [ -d "node_modules/.bin/ts-node" ]; then
    npx ts-node src/database/migrations.ts
else
    node dist/database/migrations.js
fi

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${YELLOW}💡 Remember to restart your backend service if needed${NC}"










