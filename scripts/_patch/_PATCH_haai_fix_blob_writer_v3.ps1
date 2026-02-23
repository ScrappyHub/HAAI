param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }
function EnsureDir([string]$p){ if([string]::IsNullOrWhiteSpace($p)){ Die "EnsureDir: empty" }; if(-not (Test-Path -LiteralPath $p -PathType Container)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function Parse-GateFile([string]$Path){ if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }; $tok=$null; $err=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err); if($err -ne $null -and $err.Count -gt 0){ $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"; Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m) } }
function WriteTextUtf8NoBomLf([string]$Path,[string]$Text){ $enc = New-Object System.Text.UTF8Encoding($false); $t = ($Text -replace "`r`n","`n") -replace "`r","`n"; if(-not $t.EndsWith("`n")){ $t += "`n" }; $dir = Split-Path -Parent $Path; if($dir){ EnsureDir $dir }; [System.IO.File]::WriteAllText($Path,$t,$enc) }

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$cap = Join-Path $ScriptsDir "haai_capture_v1.ps1"
if(-not (Test-Path -LiteralPath $cap -PathType Leaf)){ Die ("MISSING_CAPTURE: " + $cap) }

$enc = New-Object System.Text.UTF8Encoding($false)
$raw = [System.IO.File]::ReadAllText($cap,$enc)

# 1) Ensure helper exists (insert before first function definition if missing).
if($raw -notmatch "function\s+Write-Utf8NoBomNoFinalLf\s*\("){
  $h = @()
  $h += ""
  $h += "function Write-Utf8NoBomNoFinalLf([string]$Path,[string]$Text){"
  $h += "  $enc = New-Object System.Text.UTF8Encoding($false)"
  $h += "  $t = ($Text -replace '`r`n','`n') -replace '`r','`n'"
  $h += "  $dir = Split-Path -Parent $Path"
  $h += "  if($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }"
  $h += "  [System.IO.File]::WriteAllText($Path,$t,$enc)"
  $h += "}"
  $h += ""
  $raw = (($h -join "`n") + $raw)
}

# 2) Targeted replace: only lines that look like blob/content writes.
$lines = @($raw -split "`n",0)
$outL = New-Object System.Collections.Generic.List[string]
foreach($ln in @($lines)){
  $x = $ln
  $isBlobLine = $false
  if($x -match "payload\\blobs"){ $isBlobLine = $true }
  if($x -match "\\\\content"""){ $isBlobLine = $true }
  if($isBlobLine -and ($x -match "Write-Utf8NoBomLf\s*\(")){
    $x = $x -replace "Write-Utf8NoBomLf\s*\(", "Write-Utf8NoBomNoFinalLf("
  }
  [void]$outL.Add($x)
}
$out = (@($outL.ToArray()) -join "`n")
if(-not $out.EndsWith("`n")){ $out += "`n" }
WriteTextUtf8NoBomLf $cap $out
Parse-GateFile $cap
Write-Output ("PATCHED_CAPTURE_OK: " + $cap)
