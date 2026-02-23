param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }

function EnsureDir([string]$p){
  if([string]::IsNullOrWhiteSpace($p)){ Die "EnsureDir: empty" }
  if(-not (Test-Path -LiteralPath $p -PathType Container)){
    New-Item -ItemType Directory -Force -Path $p | Out-Null
  }
}

function Write-Utf8NoBomLf([string]$Path,[string]$Text){
  if([string]::IsNullOrWhiteSpace($Path)){ Die "WRITE_EMPTY_PATH" }
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}

function Parse-GateFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }
  $tok=$null; $err=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err)
  if($err -ne $null -and $err.Count -gt 0){
    $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"
    Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m)
  }
}

$RepoRoot   = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
EnsureDir $ScriptsDir

$builder = Join-Path $ScriptsDir "haai_build_packet_optionA_v1.ps1"
if(-not (Test-Path -LiteralPath $builder -PathType Leaf)){ Die ("MISSING_BUILDER: " + $builder) }

$enc = New-Object System.Text.UTF8Encoding($false)
$txt = [System.IO.File]::ReadAllText($builder,$enc)

# Replace any $pid / $PID (case-insensitive) token with $packetId
$new = [regex]::Replace($txt, '\$(?i:pid)\b', '$packetId')

if($new -ne $txt){
  Write-Utf8NoBomLf $builder $new
  Parse-GateFile $builder
  Write-Output ("PATCHED_BUILDER_PID_OK: " + $builder)
} else {
  Parse-GateFile $builder
  Write-Output ("BUILDER_ALREADY_OK: " + $builder)
}

Write-Output "HAAI_PATCH_OK"
