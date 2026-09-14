$ErrorActionPreference = 'Stop'

$repoRoot = 'C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform'
Set-Location $repoRoot

Write-Host '==> Stopping app listeners on ports 3000, 3010, 3020, 3030...'
Get-NetTCPConnection -LocalPort 3000,3010,3020,3030 -ErrorAction SilentlyContinue | ForEach-Object {
    $procId = $_.OwningProcess
    if ($procId -and $procId -gt 0) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

Write-Host '==> Stopping Docker Compose stack...'
docker compose -f infra/docker-compose.yml down

Write-Host '==> Stack stopped.'
