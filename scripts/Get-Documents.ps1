param(
    [Parameter(Mandatory = $true)][string]$Type,
    [int]$Limit = 20,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$cfg = Invoke-RestMethod "$ApiBase/api/plugins/sanity/config"

if (-not $cfg.configured) {
    Write-Host "`n  Sanity not configured. Add credentials in Settings > Plugins.`n" -ForegroundColor Yellow
    return
}

$docs = Invoke-RestMethod "$ApiBase/api/plugins/sanity/documents/$Type`?limit=$Limit"

if (-not $docs -or $docs.Count -eq 0) {
    Write-Host "`n  No documents found for type '$Type'.`n" -ForegroundColor Yellow
    return
}

Write-Host "`n  === $Type Documents ===" -ForegroundColor Cyan
Write-Host "  Showing $($docs.Count) most recently updated" -ForegroundColor DarkGray

foreach ($doc in $docs) {
    $title = if ($doc.title) { $doc.title }
             elseif ($doc.name) { $doc.name }
             elseif ($doc.heading) { $doc.heading }
             else { $doc._id }

    $updated = if ($doc._updatedAt) {
        ([datetime]$doc._updatedAt).ToString("MMM dd, yyyy")
    } else { "--" }

    Write-Host "`n  $title" -ForegroundColor White -NoNewline
    Write-Host "  ($updated)" -ForegroundColor DarkGray

    # Show a few data fields
    $keys = $doc.PSObject.Properties.Name | Where-Object { -not $_.StartsWith('_') } | Select-Object -First 5
    foreach ($k in $keys) {
        $val = $doc.$k
        if ($val -is [string]) { $val = $val.Substring(0, [Math]::Min($val.Length, 60)) }
        elseif ($val -ne $null) { $val = ($val | ConvertTo-Json -Compress).Substring(0, [Math]::Min(60, ($val | ConvertTo-Json -Compress).Length)) }
        else { $val = "(empty)" }
        Write-Host "    $k`: $val" -ForegroundColor DarkGray
    }
}

Write-Host "`n"
