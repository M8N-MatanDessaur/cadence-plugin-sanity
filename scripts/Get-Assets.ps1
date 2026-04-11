param(
    [ValidateSet("all", "image", "file")][string]$Type = "all",
    [int]$Limit = 50,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$r = Invoke-RestMethod "$ApiBase/api/plugins/sanity/assets?type=$Type&limit=$Limit"

if (-not $r.assets -or $r.assets.Count -eq 0) {
    Write-Host "`n  No assets found.`n" -ForegroundColor DarkGray
    return
}

Write-Host "`n  === Assets ($($r.assets.Count) of $($r.total)) ===" -ForegroundColor Cyan

foreach ($a in $r.assets) {
    $name = if ($a.originalFilename) { $a.originalFilename } else { $a._id }
    $size = if ($a.size) { [math]::Round($a.size / 1024, 1).ToString() + " KB" } else { "--" }
    $dims = ""
    if ($a.metadata -and $a.metadata.dimensions) {
        $dims = " ($($a.metadata.dimensions.width)x$($a.metadata.dimensions.height))"
    }
    Write-Host "`n  $name$dims" -ForegroundColor White -NoNewline
    Write-Host "  $size" -ForegroundColor DarkGray
    Write-Host "    $($a.url)" -ForegroundColor DarkGray
}
Write-Host ""
