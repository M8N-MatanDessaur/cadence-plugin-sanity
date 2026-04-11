param(
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$comps = Invoke-RestMethod "$ApiBase/api/plugins/sanity/repo/components"

if ($comps.error) {
    Write-Host "`n  Error: $($comps.error)" -ForegroundColor Red
    return
}

if (-not $comps -or $comps.Count -eq 0) {
    Write-Host "`n  No component files found in the local repo." -ForegroundColor Yellow
    Write-Host "  Make sure the Local Repo Path is set in Settings > Plugins > Sanity.`n" -ForegroundColor DarkGray
    return
}

Write-Host "`n  === Frontend Components ($($comps.Count)) ===" -ForegroundColor Cyan

foreach ($c in $comps) {
    Write-Host "  $($c.relativePath)" -ForegroundColor White
}
Write-Host ""
