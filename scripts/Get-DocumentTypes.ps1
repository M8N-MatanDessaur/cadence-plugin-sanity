param(
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$cfg = Invoke-RestMethod "$ApiBase/api/plugins/sanity/config"

if (-not $cfg.configured) {
    Write-Host "`n  Sanity not configured. Add credentials in Settings > Plugins.`n" -ForegroundColor Yellow
    return
}

$types = Invoke-RestMethod "$ApiBase/api/plugins/sanity/types"
if (-not $types -or $types.Count -eq 0) {
    Write-Host "`n  No document types found.`n" -ForegroundColor Yellow
    return
}

Write-Host "`n  === Sanity Document Types ===" -ForegroundColor Cyan

$sorted = $types | Sort-Object -Property count -Descending

foreach ($dt in $sorted) {
    $bar = '#' * [Math]::Min($dt.count, 40)
    Write-Host "  $($dt.name.PadRight(24))" -ForegroundColor White -NoNewline
    Write-Host " $($dt.count.ToString().PadLeft(5))" -ForegroundColor Cyan -NoNewline
    Write-Host "  $bar" -ForegroundColor DarkGray
}

$total = ($types | Measure-Object -Property count -Sum).Sum
Write-Host "`n  Total: $($types.Count) types, $total documents`n" -ForegroundColor DarkGray
