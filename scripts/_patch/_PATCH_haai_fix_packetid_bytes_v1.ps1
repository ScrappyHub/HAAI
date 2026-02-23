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

function Parse-GateFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }
  $tok=$null; $err=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err)
  if($err -ne $null -and $err.Count -gt 0){
    $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"
    Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m)
  }
}

function Write-Utf8NoBomLf([string]$Path,[string]$Text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}

$RepoRoot   = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
EnsureDir $ScriptsDir

$builder = Join-Path $ScriptsDir "haai_build_packet_optionA_v1.ps1"
if(-not (Test-Path -LiteralPath $builder -PathType Leaf)){ Die ("MISSING_BUILDER: " + $builder) }

$enc = New-Object System.Text.UTF8Encoding($false)
$txt = [System.IO.File]::ReadAllText($builder,$enc)

# Replace PacketId derivation to hash EXACT on-disk manifest.json bytes:
# from: Sha256HexBytes ($enc.GetBytes($mJson))
# to:   Sha256HexBytes ([System.IO.File]::ReadAllBytes($mPath))

$re  = 'Sha256HexBytes\s*\(\s*\$enc\.GetBytes\(\s*\$mJson\s*\)\s*\)'
$rep = 'Sha256HexBytes ([System.IO.File]::ReadAllBytes($mPath))'
$new = [regex]::Replace($txt, $re, $rep)

if($new -eq $txt){
  # fallback: some earlier edit may have different whitespace; do a broader replace
  $re2 = 'Sha256HexBytes\s*\(\s*\$enc\.GetBytes\(\s*\$mJson\s*\)\s*\)'
  $new = [regex]::Replace($txt, $re2, $rep)
}

if($new -eq $txt){
  Die "PATCH_NOOP_PACKETID_PATTERN_NOT_FOUND"
}

Write-Utf8NoBomLf $builder $new
Parse-GateFile $builder
Write-Output ("PATCHED_PACKETID_BYTES_OK: " + $builder)
Write-Output "HAAI_PATCH_OK"
