$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
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

function Wait-ForPostgresContainers {
    param(
        [int]$TimeoutSeconds = 120
    )

    $containerNames = @(
        'mileshop-notification-postgres',
        'mileshop-catalog-postgres',
        'mileshop-orders-postgres',
        'mileshop-identity-postgres'
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $allHealthy = $true
        foreach ($containerName in $containerNames) {
            $health = docker inspect --format '{{.State.Health.Status}}' $containerName
            if ($LASTEXITCODE -ne 0 -or $health.Trim() -ne 'healthy') {
                $allHealthy = $false
                break
            }
        }

        if ($allHealthy) {
            return
        }

        Start-Sleep -Seconds 2
    }

    throw "Timed out waiting for PostgreSQL containers to become healthy."
}

function Start-ServiceProcess {
    param(
        [string]$Port,
        [string]$Workspace,
        [hashtable]$EnvironmentVars,
        [string]$LogPath
    )

    $envAssignments = @("set PORT=$Port")
    foreach ($key in $EnvironmentVars.Keys) {
        $envAssignments += "set $key=$($EnvironmentVars[$key])"
    }

    $command = ($envAssignments -join '&&') + "&&npm run start --workspace $Workspace > `"$LogPath`" 2>&1"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', $command -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
}

function Assert-AppPortsAvailable {
    $ports = @(3000, 3010, 3020, 3030, 3040)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) {
        return
    }

    $conflicts = foreach ($listener in ($listeners | Sort-Object LocalPort, OwningProcess -Unique)) {
        $processName = try {
            (Get-Process -Id $listener.OwningProcess -ErrorAction Stop).ProcessName
        }
        catch {
            'unknown process'
        }

        "Port $($listener.LocalPort): PID $($listener.OwningProcess) ($processName)"
    }

    throw @"
MileShop cannot start because one or more application ports are already in use:
$($conflicts -join [Environment]::NewLine)
Inspect the owner with .\scripts\status-local-stack.ps1. Stop a process only after confirming it belongs to MileShop.
"@
}

Assert-AppPortsAvailable

Write-Host '==> Checking Docker...'
$dockerOk = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerOk) {
    throw 'Docker CLI not found in PATH.'
}

docker --version | Out-Host

Write-Host '==> Starting Postgres containers...'
docker compose -f infra/docker-compose.yml up -d
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to start PostgreSQL containers.'
}
docker compose -f infra/docker-compose.yml ps
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to inspect PostgreSQL container status.'
}

Write-Host '==> Waiting for PostgreSQL containers to become healthy...'
Wait-ForPostgresContainers

Write-Host '==> Applying Prisma migrations...'
$catalogDatabaseUrl = 'postgresql://catalog:catalog@localhost:5434/catalog?schema=public'
$notificationDatabaseUrl = 'postgresql://notifications:notifications@localhost:5433/notifications?schema=public'
$ordersDatabaseUrl = 'postgresql://orders:orders@localhost:5435/orders?schema=public'
$identityDatabaseUrl = 'postgresql://identity:identity@localhost:5436/identity?schema=public'
npm run db:deploy
if ($LASTEXITCODE -ne 0) {
    throw 'Database migrations failed; refusing to start application services.'
}

Write-Host '==> Preparing detached service logs...'
$logDirectory = Join-Path $repoRoot '.local-stack\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$catalogEnv = @{ DATABASE_URL = $catalogDatabaseUrl }
$workerEnv = @{ DATABASE_URL = $notificationDatabaseUrl }
$ordersEnv = @{ DATABASE_URL = $ordersDatabaseUrl; CATALOG_SERVICE_URL = 'http://127.0.0.1:3020'; NOTIFICATION_WORKER_URL = 'http://127.0.0.1:3010' }
$identityEnv = @{ DATABASE_URL = $identityDatabaseUrl; JWT_SECRET = 'mileshop-local-dev-secret-change-in-prod'; JWT_EXPIRES_IN = '15m'; REFRESH_TOKEN_EXPIRES_DAYS = '30'; ALLOWED_ORIGINS = 'http://localhost:3001' }
$gatewayEnv = @{ CATALOG_SERVICE_URL = 'http://127.0.0.1:3020'; ORDERS_SERVICE_URL = 'http://127.0.0.1:3030'; IDENTITY_SERVICE_URL = 'http://127.0.0.1:3040' }

$jobs = @(
    @{ Port = '3040'; Workspace = '@mileshop/identity-service'; EnvMap = $identityEnv },
    @{ Port = '3020'; Workspace = '@mileshop/catalog-service'; EnvMap = $catalogEnv },
    @{ Port = '3010'; Workspace = '@mileshop/notification-worker'; EnvMap = $workerEnv },
    @{ Port = '3030'; Workspace = '@mileshop/orders-service'; EnvMap = $ordersEnv },
    @{ Port = '3000'; Workspace = '@mileshop/api-gateway'; EnvMap = $gatewayEnv }
)

foreach ($job in $jobs) {
    $logName = ($job.Workspace -replace '^@mileshop/', '') + '.log'
    Start-ServiceProcess -Port $job.Port -Workspace $job.Workspace -EnvironmentVars $job.EnvMap -LogPath (Join-Path $logDirectory $logName)
}

Write-Host '==> Waiting for services to initialize...'
Wait-ForHttp -Uri 'http://localhost:3040/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3000/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3010/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3020/healthz' -TimeoutSeconds 60 | Out-Host
Wait-ForHttp -Uri 'http://localhost:3030/healthz' -TimeoutSeconds 60 | Out-Host

Write-Host '==> Health checks...'
Invoke-WebRequest -Uri 'http://localhost:3040/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3000/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3010/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3020/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host
Invoke-WebRequest -Uri 'http://localhost:3030/healthz' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host

Write-Host '==> Catalog smoke test...'
Invoke-WebRequest -Uri 'http://localhost:3000/catalog/products' -UseBasicParsing | Select-Object -ExpandProperty Content | Out-Host

Write-Host '==> Local stack startup complete.'
