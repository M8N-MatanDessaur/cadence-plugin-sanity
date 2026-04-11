param(
    [Parameter(Mandatory = $true)][string]$Type,
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$JsonFile,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

if (-not (Test-Path $JsonFile)) {
    Write-Host "`n  File not found: $JsonFile`n" -ForegroundColor Red
    return
}

$body = Get-Content $JsonFile -Raw -Encoding UTF8

$result = Invoke-RestMethod "$ApiBase/api/plugins/sanity/documents/$Type/$Id" -Method PATCH `
    -ContentType "application/json; charset=utf-8" -Body $body

if ($result.error) {
    Write-Host "`n  Error: $($result.error)" -ForegroundColor Red
} else {
    Write-Host "`n  Updated document '$Id' (type: $Type)" -ForegroundColor Green
}
Write-Host ""
