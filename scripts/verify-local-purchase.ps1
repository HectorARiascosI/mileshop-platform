$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Assert-Equal {
    param(
        [object]$Actual,
        [object]$Expected,
        [string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message. Expected '$Expected' but received '$Actual'."
    }
}

function Get-JsonResponse {
    param(
        [string]$Uri,
        [string]$Method = 'Get',
        [object]$Body,
        [hashtable]$Headers = @{}
    )

    $request = @{
        Uri = $Uri
        Method = $Method
        UseBasicParsing = $true
        TimeoutSec = 20
    }

    if ($Headers.Count -gt 0) {
        $request.Headers = $Headers
    }

    if ($null -ne $Body) {
        $request.ContentType = 'application/json'
        $request.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }

    Invoke-RestMethod @request
}

Write-Host '==> Checking local service health...'
foreach ($service in @(
    @{ Name = 'Gateway'; Uri = 'http://localhost:3000/healthz' },
    @{ Name = 'Notification worker'; Uri = 'http://localhost:3010/healthz' },
    @{ Name = 'Orders service'; Uri = 'http://localhost:3030/healthz' },
    @{ Name = 'Identity service'; Uri = 'http://localhost:3040/healthz' }
)) {
    $health = Get-JsonResponse -Uri $service.Uri
    Assert-Equal -Actual $health.status -Expected 'ok' -Message "$($service.Name) is not healthy"
}

$email = "customer-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$auth = Get-JsonResponse -Uri 'http://localhost:3000/auth/register' -Method Post -Body @{
    email = $email
    password = 'LocalSmokePassword123!'
    name = 'Smoke Customer'
}
if ([string]::IsNullOrWhiteSpace($auth.customerId) -or [string]::IsNullOrWhiteSpace($auth.accessToken)) {
    throw 'Identity service did not return a customer id and access token.'
}
$authorizationHeaders = @{ Authorization = "Bearer $($auth.accessToken)" }

$catalog = Get-JsonResponse -Uri 'http://localhost:3000/catalog/products'
$product = $catalog.data | Where-Object { $_.sku -eq 'MILE-MUG-001' } | Select-Object -First 1
if ($null -eq $product) {
    throw 'Smoke product MILE-MUG-001 was not returned by the active catalog.'
}

$orderInput = @{
    lines = @(
        @{
            productId = $product.id
            sku = $product.sku
            name = $product.name
            quantity = 1
            unitPriceCop = $product.priceCop
        }
    )
}

Write-Host '==> Creating order through API gateway...'
$created = Get-JsonResponse -Uri 'http://localhost:3000/orders' -Method Post -Body $orderInput -Headers $authorizationHeaders
$order = $created.data
$event = $order.event
Assert-Equal -Actual $order.totalCop -Expected $product.priceCop -Message 'Gateway returned an inconsistent order total'
Assert-Equal -Actual $event.payload.customerId -Expected $auth.customerId -Message 'Gateway returned an inconsistent customer id'
Assert-Equal -Actual $event.eventType -Expected 'OrderCreated.v1' -Message 'Gateway returned an unexpected event type'

Write-Host "Created order: $($order.orderId)"

Write-Host '==> Reading persisted order from orders-service...'
$persisted = Get-JsonResponse -Uri "http://localhost:3030/orders/$($order.orderId)"
Assert-Equal -Actual $persisted.data.orderId -Expected $order.orderId -Message 'Order was not persisted with the returned orderId'
Assert-Equal -Actual $persisted.data.customerId -Expected $auth.customerId -Message 'Persisted order has an inconsistent customer id'
Assert-Equal -Actual $persisted.data.totalCop -Expected $product.priceCop -Message 'Persisted order has an inconsistent total'

Write-Host '==> Replaying the same event to verify worker deduplication...'
$duplicate = Get-JsonResponse -Uri 'http://localhost:3010/events/order-created' -Method Post -Body $event
Assert-Equal -Actual $duplicate.status -Expected 'duplicate' -Message 'Notification worker did not deduplicate the repeated event'

Write-Host '==> Local purchase flow verified.'
