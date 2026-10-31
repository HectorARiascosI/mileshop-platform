$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$gatewayUrl = if ([string]::IsNullOrWhiteSpace($env:MILESHOP_GATEWAY_URL)) {
    'http://localhost:3000'
}
else {
    $env:MILESHOP_GATEWAY_URL.TrimEnd('/')
}
$notificationWorkerUrl = if ([string]::IsNullOrWhiteSpace($env:MILESHOP_NOTIFICATION_WORKER_URL)) {
    'http://localhost:3010'
}
else {
    $env:MILESHOP_NOTIFICATION_WORKER_URL.TrimEnd('/')
}
$ordersServiceUrl = if ([string]::IsNullOrWhiteSpace($env:MILESHOP_ORDERS_SERVICE_URL)) {
    'http://localhost:3030'
}
else {
    $env:MILESHOP_ORDERS_SERVICE_URL.TrimEnd('/')
}
$identityServiceUrl = if ([string]::IsNullOrWhiteSpace($env:MILESHOP_IDENTITY_SERVICE_URL)) {
    'http://localhost:3040'
}
else {
    $env:MILESHOP_IDENTITY_SERVICE_URL.TrimEnd('/')
}

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
    @{ Name = 'Gateway'; Uri = "$gatewayUrl/healthz" },
    @{ Name = 'Notification worker'; Uri = "$notificationWorkerUrl/healthz" },
    @{ Name = 'Orders service'; Uri = "$ordersServiceUrl/healthz" },
    @{ Name = 'Identity service'; Uri = "$identityServiceUrl/healthz" }
)) {
    $health = Get-JsonResponse -Uri $service.Uri
    Assert-Equal -Actual $health.status -Expected 'ok' -Message "$($service.Name) is not healthy"
}

$email = "customer-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$auth = Get-JsonResponse -Uri "$gatewayUrl/auth/register" -Method Post -Body @{
    email = $email
    password = 'LocalSmokePassword123!'
    name = 'Smoke Customer'
}
if ([string]::IsNullOrWhiteSpace($auth.customerId) -or [string]::IsNullOrWhiteSpace($auth.accessToken)) {
    throw 'Identity service did not return a customer id and access token.'
}
$authorizationHeaders = @{ Authorization = "Bearer $($auth.accessToken)" }

$authorizationHeaders['Idempotency-Key'] = [Guid]::NewGuid().ToString()
$catalog = Get-JsonResponse -Uri "$gatewayUrl/catalog/products"
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
$created = Get-JsonResponse -Uri "$gatewayUrl/orders" -Method Post -Body $orderInput -Headers $authorizationHeaders
$order = $created.data
$event = $order.event
$expectedDeliveryFee = if ($product.priceCop -ge 150000) {
    0
}
else {
    [Math]::Max(12000, [Math]::Floor($product.priceCop * 0.08 + 0.5))
}
Assert-Equal -Actual $order.subtotalCop -Expected $product.priceCop -Message 'Gateway returned an inconsistent order subtotal'
Assert-Equal -Actual $order.deliveryFeeCop -Expected $expectedDeliveryFee -Message 'Gateway returned an inconsistent delivery fee'
Assert-Equal -Actual $order.totalCop -Expected ($product.priceCop + $expectedDeliveryFee) -Message 'Gateway returned an inconsistent order total'
Assert-Equal -Actual $event.payload.customerId -Expected $auth.customerId -Message 'Gateway returned an inconsistent customer id'
Assert-Equal -Actual $event.eventType -Expected 'OrderCreated.v1' -Message 'Gateway returned an unexpected event type'

Write-Host '==> Replaying the same checkout request to verify idempotency...'
$replay = Get-JsonResponse -Uri "$gatewayUrl/orders" -Method Post -Body $orderInput -Headers $authorizationHeaders
Assert-Equal -Actual $replay.data.orderId -Expected $order.orderId -Message 'Repeated checkout created a duplicate order'

Write-Host "Created order: $($order.orderId)"

Write-Host '==> Reading persisted order through API gateway...'
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    $persisted = Get-JsonResponse -Uri "$gatewayUrl/orders/$($order.orderId)" -Headers $authorizationHeaders
    if ($persisted.data.status -eq 'AWAITING_PAYMENT_PROOF') {
        break
    }
    if ($persisted.data.status -in @('RESERVATION_FAILED', 'RESERVATION_EXPIRED', 'CANCELLED')) {
        throw "Order did not reach payment-proof state; received '$($persisted.data.status)'."
    }
    Start-Sleep -Seconds 1
}
Assert-Equal -Actual $persisted.data.status -Expected 'AWAITING_PAYMENT_PROOF' -Message 'Order did not reach the payment-proof state'
Assert-Equal -Actual $persisted.data.orderId -Expected $order.orderId -Message 'Order was not persisted with the returned orderId'
Assert-Equal -Actual $persisted.data.customerId -Expected $auth.customerId -Message 'Persisted order has an inconsistent customer id'
Assert-Equal -Actual $persisted.data.subtotalCop -Expected $product.priceCop -Message 'Persisted order has an inconsistent subtotal'
Assert-Equal -Actual $persisted.data.deliveryFeeCop -Expected $expectedDeliveryFee -Message 'Persisted order has an inconsistent delivery fee'
Assert-Equal -Actual $persisted.data.totalCop -Expected ($product.priceCop + $expectedDeliveryFee) -Message 'Persisted order has an inconsistent total'

Write-Host '==> Replaying the same event to verify worker deduplication...'
$duplicate = Get-JsonResponse -Uri "$notificationWorkerUrl/events/order-created" -Method Post -Body $event
Assert-Equal -Actual $duplicate.status -Expected 'duplicate' -Message 'Notification worker did not deduplicate the repeated event'

Write-Host '==> Cancelling smoke order to release its inventory reservation...'
$cancelled = Get-JsonResponse -Uri "$gatewayUrl/orders/$($order.orderId)/cancel" -Method Post -Headers $authorizationHeaders
Assert-Equal -Actual $cancelled.data.status -Expected 'CANCELLED' -Message 'Smoke order was not cancelled after verification'

Write-Host '==> Local purchase flow verified.'
