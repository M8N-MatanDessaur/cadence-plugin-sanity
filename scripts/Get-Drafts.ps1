param(
    [int]$Limit = 50,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$drafts = Invoke-RestMethod "$ApiBase/api/plugins/sanity/drafts?limit=$Limit"

if (-not $drafts -or $drafts.Count -eq 0) {
    Write-Host "`n  No drafts found.`n" -ForegroundColor DarkGray
    return
}

Write-Host "`n  === Drafts ($($drafts.Count)) ===" -ForegroundColor Cyan

foreach ($d in $drafts) {
    $title = if ($d.title) { $d.title } elseif ($d.name) { $d.name } elseif ($d.heading) { $d.heading } else { $d._id }
    $updated = if ($d._updatedAt) { ([datetime]$d._updatedAt).ToString("MMM dd, yyyy") } else { "--" }
    Write-Host "`n  $title" -ForegroundColor Yellow -NoNewline
    Write-Host "  ($($d._type))" -ForegroundColor DarkGray
    Write-Host "    ID: $($d._id)" -ForegroundColor DarkGray
    Write-Host "    Updated: $updated" -ForegroundColor DarkGray
}
Write-Host ""
