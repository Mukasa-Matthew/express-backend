# PowerShell script to setup fresh database
# Run: .\scripts\setup-fresh-db.ps1

Write-Host "🚀 Setting up fresh database..." -ForegroundColor Green
Write-Host ""

# Check if PostgreSQL service is running
Write-Host "📋 Checking PostgreSQL service..." -ForegroundColor Yellow
$pgService = Get-Service | Where-Object { $_.Name -like "*postgresql*" -or $_.Name -like "*postgres*" }

if ($pgService) {
    if ($pgService.Status -eq "Running") {
        Write-Host "✅ PostgreSQL service is running" -ForegroundColor Green
    } else {
        Write-Host "⚠️  PostgreSQL service is stopped. Starting..." -ForegroundColor Yellow
        Start-Service $pgService.Name
        Start-Sleep -Seconds 3
        Write-Host "✅ PostgreSQL service started" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  PostgreSQL service not found. Please ensure PostgreSQL is installed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📋 Running Prisma migrations..." -ForegroundColor Yellow

# Change to backend directory
Set-Location $PSScriptRoot\..

# Run migrations
try {
    npx prisma migrate dev --name init
    Write-Host ""
    Write-Host "✅ Database setup complete!" -ForegroundColor Green
    Write-Host "📋 Next: Run 'npm run dev' to start the server" -ForegroundColor Cyan
} catch {
    Write-Host ""
    Write-Host "❌ Migration failed. Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "📋 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Check PostgreSQL is running: Get-Service postgresql*" 
    Write-Host "   2. Verify database exists: psql -U postgres -l"
    Write-Host "   3. Check .env file has correct database credentials"
    Write-Host "   4. Try: npm run prisma:migrate:deploy"
    exit 1
}


