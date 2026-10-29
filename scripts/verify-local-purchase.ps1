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
        [object]$Body
    )

    $request = @{
        Uri = $Uri
        Method = $Method
        UseBasicParsing = $true
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
    @{ Name = 'Orders service'; Uri = 'http://localhost:3030/healthz' }
)) {
    $health = Get-JsonResponse -Uri $service.Uri
    Assert-Equal -Actual $health.status -Expected 'ok' -Message "$($service.Name) is not healthy"
}

$customerId = "customer-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$catalog = Get-JsonResponse -Uri 'http://localhost:3000/catalog/products'
$product = $catalog.data | Where-Object { $_.sku -eq 'MILE-MUG-001' } | Select-Object -First 1
if ($null -eq $product) {
    throw 'Smoke product MILE-MUG-001 was not returned by the active catalog.'
}

$orderInput = @{
    customerId = $customerId
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
$created = Get-JsonResponse -Uri 'http://localhost:3000/orders' -Method Post -Body $orderInput
$order = $created.data
$event = $order.event
Assert-Equal -Actual $order.totalCop -Expected $product.priceCop -Message 'Gateway returned an inconsistent order total'
Assert-Equal -Actual $event.payload.customerId -Expected $customerId -Message 'Gateway returned an inconsistent customer id'
Assert-Equal -Actual $event.eventType -Expected 'OrderCreated.v1' -Message 'Gateway returned an unexpected event type'

Write-Host "Created order: $($order.orderId)"

Write-Host '==> Reading persisted order from orders-service...'
$persisted = Get-JsonResponse -Uri "http://localhost:3030/orders/$($order.orderId)"
Assert-Equal -Actual $persisted.data.orderId -Expected $order.orderId -Message 'Order was not persisted with the returned orderId'
Assert-Equal -Actual $persisted.data.customerId -Expected $customerId -Message 'Persisted order has an inconsistent customer id'
Assert-Equal -Actual $persisted.data.totalCop -Expected $product.priceCop -Message 'Persisted order has an inconsistent total'

Write-Host '==> Replaying the same event to verify worker deduplication...'
$duplicate = Get-JsonResponse -Uri 'http://localhost:3010/events/order-created' -Method Post -Body $event
Assert-Equal -Actual $duplicate.status -Expected 'duplicate' -Message 'Notification worker did not deduplicate the repeated event'

Write-Host '==> Local purchase flow verified.'
