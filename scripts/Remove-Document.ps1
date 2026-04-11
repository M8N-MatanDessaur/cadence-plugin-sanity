param(
    [Parameter(Mandatory = $true)][string]$Type,
    [Parameter(Mandatory = $true)][string]$Id,
    [switch]$Force,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

if (-not $Force) {
    $confirm = Read-Host "  Delete document '$Id' of type '$Type'? (y/N)"
    if ($confirm -ne 'y') {
        Write-Host "  Cancelled.`n" -ForegroundColor DarkGray
        return
    }
}

$result = Invoke-RestMethod "$ApiBase/api/plugins/sanity/documents/$Type/$Id" -Method DELETE

if ($result.error) {
    Write-Host "`n  Error: $($result.error)" -ForegroundColor Red
} elseif ($result.ok) {
    Write-Host "`n  Deleted document '$Id'" -ForegroundColor Green
}
Write-Host ""
