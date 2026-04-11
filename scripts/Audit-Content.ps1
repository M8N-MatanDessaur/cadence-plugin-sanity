param(
    [Parameter(Mandatory = $true)][string]$Type,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$r = Invoke-RestMethod "$ApiBase/api/plugins/sanity/audit/$Type"

if ($r.error) {
    Write-Host "`n  Error: $($r.error)" -ForegroundColor Red
    return
}

Write-Host "`n  === Content Audit: $Type ===" -ForegroundColor Cyan
Write-Host "  Total Documents: $($r.totalDocuments)" -ForegroundColor DarkGray

if (-not $r.issues -or $r.issues.Count -eq 0) {
    Write-Host "`n  No issues found!" -ForegroundColor Green
} else {
    Write-Host "  Issues Found: $($r.issues.Count)" -ForegroundColor Yellow
    Write-Host ""
    foreach ($iss in $r.issues) {
        $color = if ($iss.level -eq 'warn') { "Yellow" } else { "DarkGray" }
        $title = if ($iss.title) { $iss.title } else { $iss.docId }
        Write-Host "  [$($iss.level.ToUpper())] $title" -ForegroundColor $color
        Write-Host "    $($iss.issue)" -ForegroundColor DarkGray
    }
}
Write-Host ""
