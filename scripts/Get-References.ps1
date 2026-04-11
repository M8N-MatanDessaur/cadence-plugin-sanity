param(
    [Parameter(Mandatory = $true)][string]$Type,
    [Parameter(Mandatory = $true)][string]$Id,
    [string]$ApiBase = "http://127.0.0.1:3800"
)

$r = Invoke-RestMethod "$ApiBase/api/plugins/sanity/documents/$Type/$Id/references"

if ($r.error) {
    Write-Host "`n  Error: $($r.error)" -ForegroundColor Red
    return
}

Write-Host "`n  === References for $Id ===" -ForegroundColor Cyan

Write-Host "`n  Incoming ($($r.incoming.Count)):" -ForegroundColor White
if ($r.incoming.Count -eq 0) {
    Write-Host "    (none)" -ForegroundColor DarkGray
} else {
    foreach ($ref in $r.incoming) {
        $title = if ($ref.title) { $ref.title } elseif ($ref.name) { $ref.name } else { $ref._id }
        Write-Host "    <- $title" -ForegroundColor Blue -NoNewline
        Write-Host "  ($($ref._type))" -ForegroundColor DarkGray
    }
}

Write-Host "`n  Outgoing ($($r.outgoing.Count)):" -ForegroundColor White
if ($r.outgoing.Count -eq 0) {
    Write-Host "    (none)" -ForegroundColor DarkGray
} else {
    foreach ($ref in $r.outgoing) {
        $title = if ($ref.title) { $ref.title } else { $ref._ref }
        Write-Host "    -> $title" -ForegroundColor Magenta -NoNewline
        Write-Host "  ($($ref.resolvedType))" -ForegroundColor DarkGray
    }
}
Write-Host ""
