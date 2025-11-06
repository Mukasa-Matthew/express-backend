# Reset Database Script
# This script drops and recreates the database

Write-Host "🗑️  Resetting database..." -ForegroundColor Yellow

# Get database credentials from .env or use defaults
$DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
$DB_HOST = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "lts_portal" }
$DB_PASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "" }

# Set password if provided
if ($DB_PASSWORD) {
    $env:PGPASSWORD = $DB_PASSWORD
}

Write-Host "📋 Dropping database: $DB_NAME" -ForegroundColor Cyan
$dropResult = psql -U $DB_USER -h $DB_HOST -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Warning: Drop command had issues (might not exist)" -ForegroundColor Yellow
}

Write-Host "📋 Creating database: $DB_NAME" -ForegroundColor Cyan
$createResult = psql -U $DB_USER -h $DB_HOST -c "CREATE DATABASE $DB_NAME;" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Database reset successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🚀 You can now start the backend with: npm run dev" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to create database" -ForegroundColor Red
    Write-Host $createResult
    exit 1
}





