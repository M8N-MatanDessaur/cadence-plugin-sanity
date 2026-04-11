param(
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$cfg = Invoke-RestMethod "$ApiBase/api/plugins/sanity/config"

if (-not $cfg.configured) {
    Write-Host "`n  Sanity not configured. Add credentials in Settings > Plugins.`n" -ForegroundColor Yellow
    return
}

Write-Host "`n  === Sanity.io Project Overview ===" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'dddd, MMMM dd yyyy')" -ForegroundColor DarkGray

$test = Invoke-RestMethod "$ApiBase/api/plugins/sanity/test"
if (-not $test.ok) {
    Write-Host "  Connection failed: $($test.error)" -ForegroundColor Red
    return
}

Write-Host "  Project: $($test.projectId) | Dataset: $($test.dataset)" -ForegroundColor DarkGray

$types = Invoke-RestMethod "$ApiBase/api/plugins/sanity/types"
if (-not $types) { $types = @() }

$totalDocs = 0

foreach ($dt in $types) {
    $totalDocs += $dt.count
    Write-Host "`n  $($dt.name)" -ForegroundColor White -NoNewline
    Write-Host " ($($dt.count) documents)" -ForegroundColor DarkGray
}

Write-Host "`n  ─────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Types: $($types.Count) | Total Documents: $totalDocs" -ForegroundColor White
Write-Host ""
