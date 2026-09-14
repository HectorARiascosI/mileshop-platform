$ErrorActionPreference = 'Stop'

$repoRoot = 'C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform'
Set-Location $repoRoot

function Wait-ForHttp {
    param(
        [string]$Uri,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                return $response.Content
            }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    throw "Timed out waiting for $Uri"
}

function Start-ServiceInCurrentSession {
    param(
        [string]$Port,
        [string]$Workspace,
        [hashtable]$EnvironmentVars
    )

    $block = {
        param($workspace, $port, $envMap)

        Set-Location $workspace
        foreach ($key in $envMap.Keys) {
            Set-Item -Path "Env:$key" -Value $envMap[$key]
        }

        $env:PORT = $port
        npm run start --workspace $workspace
    }

    & $block $Workspace $Port $EnvironmentVars
}

Write-Host '==> Checking Docker...'
$dockerOk = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerOk) {
    throw 'Docker CLI not found in PATH.'
}

docker --version | Out-Host

Write-Host '==> Starting Postgres containers...'
docker compose -f infra/docker-compose.yml up -d | Out-Host
docker compose -f infra/docker-compose.yml ps | Out-Host

Write-Host '==> Clearing stale Node listeners on app ports...'
Get-NetTCPConnection -LocalPort 3000,3010,3020,3030 -ErrorAction SilentlyContinue | ForEach-Object {
    $procId = $_.OwningProcess
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

Write-Host '==> Starting services in a single PowerShell session...'
$catalogEnv = @{ DATABASE_URL = 'postgresql://catalog:catalog@localhost:5434/catalog?schema=public' }
$workerEnv = @{ DATABASE_URL = 'postgresql://notifications:notifications@localhost:5433/notifications?schema=public' }
$ordersEnv = @{ DATABASE_URL = 'postgresql://orders:orders@localhost:5435/orders?schema=public' }
$gatewayEnv = @{ CATALOG_SERVICE_URL = 'http://127.0.0.1:3020'; NOTIFICATION_WORKER_URL = 'http://127.0.0.1:3010' }

$jobs = @(
    @{ Port = '3020'; Workspace = '@mileshop/catalog-service'; EnvMap = $catalogEnv },
    @{ Port = '3010'; Workspace = '@mileshop/notification-worker'; EnvMap = $workerEnv },
    @{ Port = '3030'; Workspace = '@mileshop/orders-service'; EnvMap = $ordersEnv },
    @{ Port = '3000'; Workspace = '@mileshop/api-gateway'; EnvMap = $gatewayEnv }
)

foreach ($job in $jobs) {
    Start-Job -Name $job.Workspace -ScriptBlock {
        param($repoRoot, $port, $workspace, $envMap)
        Set-Location $repoRoot
        foreach ($key in $envMap.Keys) {
            Set-Item -Path "Env:$key" -Value $envMap[$key]
        }
        $env:PORT = $port
        npm run start --workspace $workspace
    } -ArgumentList $repoRoot, $job.Port, $job.Workspace, $job.EnvMap | Out-Null
}

Write-Host '==> Waiting for services to initialize...'
Wait-ForHttp -Uri 'http://localhost:3000/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3010/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3020/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3030/healthz' -TimeoutSeconds 60 | Out-Host

Write-Host '==> Health checks...'
Invoke-WebRequest -Uri 'http://localhost:3000/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3010/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3020/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3030/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host

Write-Host '==> Catalog smoke test...'
Invoke-WebRequest -Uri 'http://localhost:3000/catalog/products' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host

Write-Host '==> Local stack startup complete.'
