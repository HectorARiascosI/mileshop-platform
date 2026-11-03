$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$databases = @(
    @{ Name = 'catalog-service'; WorkspaceScript = 'db:deploy:catalog-service'; Url = 'postgresql://catalog:catalog@localhost:5434/catalog?schema=public' },
    @{ Name = 'notification-worker'; WorkspaceScript = 'db:deploy:notification-worker'; Url = 'postgresql://notifications:notifications@localhost:5433/notifications?schema=public' },
    @{ Name = 'orders-service'; WorkspaceScript = 'db:deploy:orders-service'; Url = 'postgresql://orders:orders@localhost:5435/orders?schema=public' },
    @{ Name = 'identity-service'; WorkspaceScript = 'db:deploy:identity-service'; Url = 'postgresql://identity:identity@localhost:5436/identity?schema=public' }
)

foreach ($database in $databases) {
    Write-Host "==> Applying migration: $($database.Name)"
    if ($database.Name -eq 'catalog-service') {
        $catalogDatabaseUrl = $database.Url
    }
    $env:DATABASE_URL = $database.Url
    npm run $database.WorkspaceScript | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Migration failed for $($database.Name)."
    }
}

Write-Host '==> Seeding catalog data.'
$env:DATABASE_URL = $catalogDatabaseUrl
npm run db:seed:catalog | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw 'Catalog seed failed.'
}

Write-Host '==> Database migrations complete.'
