# PowerShell script to create tables from SQL file (workaround)
# Run: .\scripts\create-tables-from-sql.ps1

param(
    [string]$DatabaseName = "lts_portal",
    [string]$User = "postgres",
    [string]$Host = "localhost",
    [string]$Port = "5432"
)

Write-Host "🚀 Creating database tables from SQL file..." -ForegroundColor Green
Write-Host ""

# Get password from environment or prompt
$password = $env:DB_PASSWORD
if (-not $password) {
    $securePassword = Read-Host "Enter PostgreSQL password for user '$User'" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

# Set PGPASSWORD environment variable
$env:PGPASSWORD = $password

# Change to backend directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptPath "..")

# SQL file path
$sqlFile = Join-Path $PWD "src\database\create-all-tables.sql"

if (-not (Test-Path $sqlFile)) {
    Write-Host "❌ SQL file not found: $sqlFile" -ForegroundColor Red
    exit 1
}

Write-Host "📋 Running SQL file: $sqlFile" -ForegroundColor Yellow
Write-Host ""

# Run SQL file
$connectionString = "host=$Host port=$Port dbname=$DatabaseName user=$User"
$result = & psql $connectionString -f $sqlFile 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Tables created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Cyan
    Write-Host "   1. Create Prisma migration: npx prisma migrate dev --create-only --name init"
    Write-Host "   2. Mark as applied: npx prisma migrate resolve --applied init"
    Write-Host "   3. Start server: npm run dev"
} else {
    Write-Host ""
    Write-Host "❌ Error creating tables:" -ForegroundColor Red
    Write-Host $result
    exit 1
}

# Clear password
Remove-Item Env:\PGPASSWORD


