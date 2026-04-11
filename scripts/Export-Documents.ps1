param(
    [Parameter(Mandatory = $true)][string]$Type,
    [string]$OutFile,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$result = Invoke-RestMethod "$ApiBase/api/plugins/sanity/documents/$Type/export" -Method POST

if ($result.error) {
    Write-Host "`n  Error: $($result.error)" -ForegroundColor Red
    return
}

$json = $result | ConvertTo-Json -Depth 20

if ($OutFile) {
    $json | Out-File -FilePath $OutFile -Encoding UTF8
    Write-Host "`n  Exported $($result.Count) documents to $OutFile" -ForegroundColor Green
} else {
    Write-Host "`n  === Export: $Type ($($result.Count) documents) ===" -ForegroundColor Cyan
    $json | Write-Host
}
Write-Host ""
