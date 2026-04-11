param(
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$info = Invoke-RestMethod "$ApiBase/api/plugins/sanity/repo/info"

if ($info.error) {
    Write-Host "`n  Error: $($info.error)" -ForegroundColor Red
    return
}

Write-Host "`n  === Local Repo Info ===" -ForegroundColor Cyan
Write-Host "  Path:             $($info.repoPath)" -ForegroundColor White
Write-Host "  Framework:        $($info.framework)" -ForegroundColor White
Write-Host "  Has package.json: $($info.hasPackageJson)" -ForegroundColor DarkGray
Write-Host "  Sanity Config:    $($info.hasSanityConfig)" -ForegroundColor DarkGray
if ($info.studioPath) {
    Write-Host "  Studio Path:      $($info.studioPath)" -ForegroundColor Green
}
Write-Host ""
