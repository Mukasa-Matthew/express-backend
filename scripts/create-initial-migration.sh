#!/bin/bash

# Script to create initial Prisma migration for fresh database

echo "🚀 Creating initial Prisma migration..."

cd "$(dirname "$0")/.."

# Create migration with name "init"
npx prisma migrate dev --name init --create-only

echo "✅ Migration files created!"
echo ""
echo "Next steps:"
echo "1. Review the migration files in prisma/migrations/"
echo "2. Apply the migration: npm run prisma:migrate:deploy"
echo "3. Or for development: npm run prisma:migrate"
echo "4. Start your server: npm run dev"


