param(
    [Parameter(Mandatory = $true)][string]$Query,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$body = @{ query = $Query } | ConvertTo-Json

$result = Invoke-RestMethod "$ApiBase/api/plugins/sanity/groq" -Method POST `
    -ContentType "application/json; charset=utf-8" -Body $body

if ($result.error) {
    Write-Host "`n  Error: $($result.error)" -ForegroundColor Red
} else {
    Write-Host "`n  === GROQ Results ===" -ForegroundColor Cyan
    $result | ConvertTo-Json -Depth 10 | Write-Host
}
Write-Host ""
