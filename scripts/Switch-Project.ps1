param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$body = @{ name = $Name } | ConvertTo-Json

$result = Invoke-RestMethod "$ApiBase/api/plugins/sanity/projects/active" -Method POST `
    -ContentType "application/json" -Body $body

if ($result.error) {
    Write-Host "`n  Error: $($result.error)" -ForegroundColor Red
} elseif ($result.ok) {
    Write-Host "`n  Switched to project: $($result.activeProject)" -ForegroundColor Green
}
Write-Host ""
