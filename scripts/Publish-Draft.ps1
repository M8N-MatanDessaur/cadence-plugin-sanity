param(
    [Parameter(Mandatory = $true)][string]$Id,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$draftId = if ($Id.StartsWith("drafts.")) { $Id } else { "drafts.$Id" }

$result = Invoke-RestMethod "$ApiBase/api/plugins/sanity/drafts/$([uri]::EscapeDataString($draftId))/publish" -Method POST

if ($result.error) {
    Write-Host "`n  Error: $($result.error)" -ForegroundColor Red
} elseif ($result.ok) {
    Write-Host "`n  Published: $($result.publishedId)" -ForegroundColor Green
}
Write-Host ""
