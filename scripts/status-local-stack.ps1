$ErrorActionPreference = 'Stop'

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
    docker compose -f "C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform\infra\docker-compose.yml" ps | Out-Host
}
catch {
    Write-Host 'Docker Compose stack is not running.'
}

Write-Host ''
Write-Host '==> App ports ==>'
$ports = @(3000, 3010, 3020, 3030)
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
Write-Host '==> Health checks ==>'
$checks = @(
    @{ Name = 'Gateway'; Url = 'http://localhost:3000/healthz' },
    @{ Name = 'Notification worker'; Url = 'http://localhost:3010/healthz' },
    @{ Name = 'Catalog service'; Url = 'http://localhost:3020/healthz' },
    @{ Name = 'Orders service'; Url = 'http://localhost:3030/healthz' }
)

foreach ($item in $checks) {
    try {
        $response = Invoke-WebRequest -Uri $item.Url -UseBasicParsing -TimeoutSec 5
        Write-Host ($item.Name + ' => ' + $response.Content)
    }
    catch {
        Write-Host ($item.Name + ' => DOWN')
    }
}
