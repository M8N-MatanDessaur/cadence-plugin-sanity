param(
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$schemas = Invoke-RestMethod "$ApiBase/api/plugins/sanity/repo/schemas"

if ($schemas.error) {
    Write-Host "`n  Error: $($schemas.error)" -ForegroundColor Red
    return
}

if (-not $schemas -or $schemas.Count -eq 0) {
    Write-Host "`n  No schema files found in the local repo." -ForegroundColor Yellow
    Write-Host "  Make sure the Local Repo Path is set in Settings > Plugins > Sanity.`n" -ForegroundColor DarkGray
    return
}

Write-Host "`n  === Sanity Schema Files ($($schemas.Count)) ===" -ForegroundColor Cyan

foreach ($s in $schemas) {
    Write-Host "  $($s.relativePath)" -ForegroundColor White
}
Write-Host ""
