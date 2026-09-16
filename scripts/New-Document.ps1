<#
.SYNOPSIS
    Creates a document of a type from a JSON file, as a draft (default) or published with -Publish. Prints the new id.
.EXAMPLE
    ./scripts/New-Document.ps1 -Type press -JsonFile .ai-workspace/doc.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Type,
    [Parameter(Mandatory)][string]$JsonFile,
    [switch]$Publish,
    [string]$Project = ''
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
# -Project names one of the configured Sanity projects; blank means the active one (or the one whose repository the shell is on).
$proj = if ($PSBoundParameters.ContainsKey('Project') -and $Project) { "project=$([uri]::EscapeDataString($Project))" } elseif ($env:CADENCE_ACTIVE_REPO_PATH) { "repo=$([uri]::EscapeDataString($env:CADENCE_ACTIVE_REPO_PATH))" } else { '' }
function With-Project($path) { if (-not $proj) { return $path }; if ($path.Contains('?')) { "$path&$proj" } else { "$path?$proj" } }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$(With-Project $path)" -Headers $headers -TimeoutSec 300 }
function Get-Text($path) { (Invoke-WebRequest -UseBasicParsing -Uri "$CadenceApi$(With-Project $path)" -Headers $headers -TimeoutSec 300).Content }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$(With-Project $path)" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 20))) -TimeoutSec 300 }
function Send-Api($method, $path, $payload) { $args = @{ Uri = "$CadenceApi$(With-Project $path)"; Method = $method; Headers = $headers; TimeoutSec = 300 }; if ($null -ne $payload) { $args.ContentType = 'application/json; charset=utf-8'; $args.Body = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 20)) }; Invoke-RestMethod @args }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
# -InputObject, not the pipeline: Windows PowerShell 5.1 wraps a piped JSON array in a {value, Count} object, and an empty one prints nothing.
function Out-Json($o, $d = 12) { ConvertTo-Json -InputObject $o -Depth $d }
function Read-JsonFile($file) { if (-not (Test-Path $file)) { throw "File not found: $file" }; ConvertFrom-Json -InputObject (Get-Content $file -Raw -Encoding UTF8) }
$doc = Read-JsonFile $JsonFile
$r = Post-Api "/api/plugins/sanity/documents/$(Esc $Type)$(if (-not $Publish) { '?draft=1' })" $doc
[pscustomobject]@{ ok = [bool]$r.id; id = $r.id; draft = -not $Publish; transactionId = $r.transactionId } | ConvertTo-Json
