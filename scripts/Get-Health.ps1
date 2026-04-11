param(
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$h = Invoke-RestMethod "$ApiBase/api/plugins/sanity/health"

if ($h.error) {
    Write-Host "`n  Error: $($h.error)" -ForegroundColor Red
    return
}

Write-Host "`n  === Sanity Content Health ===" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'dddd, MMMM dd yyyy')" -ForegroundColor DarkGray
Write-Host "  Project: $($h.projectId) | Dataset: $($h.dataset)" -ForegroundColor DarkGray

Write-Host "`n  Document Types:   $($h.totalTypes)" -ForegroundColor White
Write-Host "  Total Documents:  $($h.totalDocuments)" -ForegroundColor Green
Write-Host "  Drafts:           $($h.draftsCount)" -ForegroundColor $(if ($h.draftsCount -gt 20) { "Yellow" } else { "White" })
Write-Host "  Images:           $($h.assets.images)" -ForegroundColor White
Write-Host "  Files:            $($h.assets.files)" -ForegroundColor White

if ($h.repoPath) {
    Write-Host "`n  Local Repo: $($h.repoPath)" -ForegroundColor DarkGray
}
if ($h.previewUrl) {
    Write-Host "  Preview URL: $($h.previewUrl)" -ForegroundColor DarkGray
}

if ($h.issues -and $h.issues.Count -gt 0) {
    Write-Host "`n  Issues:" -ForegroundColor Yellow
    foreach ($iss in $h.issues) {
        $color = if ($iss.level -eq 'warn') { "Yellow" } elseif ($iss.level -eq 'err') { "Red" } else { "DarkGray" }
        Write-Host "    - $($iss.message)" -ForegroundColor $color
    }
}

Write-Host "`n  Types Breakdown:" -ForegroundColor White
foreach ($t in $h.types) {
    Write-Host "    $($t.name): $($t.count)" -ForegroundColor DarkGray
}

if ($h.recent -and $h.recent.Count -gt 0) {
    Write-Host "`n  Recent Activity:" -ForegroundColor White
    foreach ($d in $h.recent | Select-Object -First 5) {
        $title = if ($d.title) { $d.title } elseif ($d.name) { $d.name } elseif ($d.heading) { $d.heading } else { $d._id }
        $updated = if ($d._updatedAt) { ([datetime]$d._updatedAt).ToString("MMM dd, yyyy") } else { "--" }
        Write-Host "    $title" -ForegroundColor White -NoNewline
        Write-Host "  $($d._type) - $updated" -ForegroundColor DarkGray
    }
}

Write-Host ""
