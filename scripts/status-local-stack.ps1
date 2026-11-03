$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host '==> Docker status ==>'
try {
    docker version --format '{{.Server.Version}}' | Out-Host
}
catch {
    Write-Host 'Docker is not running or not installed.'
}

Write-Host ''
Write-Host '==> DB stack ==>'
try {
    docker compose -f (Join-Path $repoRoot 'infra/docker-compose.yml') ps | Out-Host
}
catch {
    Write-Host 'Docker Compose stack is not running.'
}

Write-Host ''
Write-Host '==> App ports ==>'
$ports = @(3000, 3010, 3020, 3030, 3040)
foreach ($port in $ports) {
    $tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($tcp) {
        $owner = $tcp.OwningProcess | Select-Object -Unique
        Write-Host "Port $port => LISTENING (PID: $owner)"
    }
    else {
        Write-Host "Port $port => CLOSED"
    }
}

Write-Host ''
Write-Host '==> Health and readiness checks ==>'
$checks = @(
    @{ Name = 'Gateway'; Url = 'http://localhost:3000/healthz'; ReadyUrl = 'http://localhost:3000/readyz' },
    @{ Name = 'Notification worker'; Url = 'http://localhost:3010/healthz'; ReadyUrl = 'http://localhost:3010/readyz' },
    @{ Name = 'Catalog service'; Url = 'http://localhost:3020/healthz'; ReadyUrl = 'http://localhost:3020/readyz' },
    @{ Name = 'Orders service'; Url = 'http://localhost:3030/healthz'; ReadyUrl = 'http://localhost:3030/readyz' },
    @{ Name = 'Identity service'; Url = 'http://localhost:3040/healthz'; ReadyUrl = 'http://localhost:3040/readyz' }
)

foreach ($item in $checks) {
    try {
        $health = Invoke-WebRequest -Uri $item.Url -UseBasicParsing -TimeoutSec 5
        $readiness = Invoke-WebRequest -Uri $item.ReadyUrl -UseBasicParsing -TimeoutSec 5
        Write-Host ($item.Name + ' => health=' + $health.Content + ' readiness=' + $readiness.Content)
    }
    catch {
        Write-Host ($item.Name + ' => DOWN')
    }
}
