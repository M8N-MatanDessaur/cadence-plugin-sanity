<#
.SYNOPSIS
    Sets fields on a document from a JSON file ({"field": value}); -Unset removes fields (comma separated). Patches the id as given (use drafts.<id> for the draft).
.EXAMPLE
    ./scripts/Update-Document.ps1 -Type press -Id press-article-1 -JsonFile .ai-workspace/patch.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Type,
    [Parameter(Mandatory)][string]$Id,
    [string]$JsonFile = '',
    [string]$Unset = '',
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
$payload = @{}
if ($JsonFile) { $payload.set = Read-JsonFile $JsonFile }
if ($Unset) { $payload.unset = @($Unset -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
if (-not $payload.Count) { throw 'Give -JsonFile with fields to set, or -Unset with fields to remove.' }
Send-Api 'PATCH' "/api/plugins/sanity/documents/$(Esc $Type)/$(Esc $Id)" $payload | ConvertTo-Json -Depth 20
