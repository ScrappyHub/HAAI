param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }
function EnsureDir([string]$p){ if([string]::IsNullOrWhiteSpace($p)){ Die "EnsureDir: empty" }; if(-not (Test-Path -LiteralPath $p -PathType Container)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function Parse-GateFile([string]$Path){ if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }; $tok=$null; $err=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err); if($err -ne $null -and $err.Count -gt 0){ $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"; Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m) } }
function Write-Utf8NoBomNoFinalLf([string]$Path,[string]$Text){
  if([string]::IsNullOrWhiteSpace($Path)){ Die "WRITE_EMPTY_PATH" }
  $enc = New-Object System.Text.UTF8Encoding($false)
  # normalize CRLF->LF but DO NOT force trailing LF
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$cap = Join-Path $ScriptsDir "haai_capture_v1.ps1"
if(-not (Test-Path -LiteralPath $cap -PathType Leaf)){ Die ("MISSING_CAPTURE: " + $cap) }

$raw = [System.IO.File]::ReadAllText($cap,(New-Object System.Text.UTF8Encoding($false)))

# 1) Ensure helper exists in capture file (append near top if absent).
if($raw -notmatch "function\s+Write-Utf8NoBomNoFinalLf\s*\("){
  # Insert after the first Write-Utf8NoBomLf definition if present; else prepend.
  $helper = @(
    ""
    "function Write-Utf8NoBomNoFinalLf([string]$Path,[string]$Text){"
    "  $enc = New-Object System.Text.UTF8Encoding($false)"
    "  $t = ($Text -replace ``"`r`n``",``"`n``") -replace ``"`r``",``"`n``""
    "  $dir = Split-Path -Parent $Path"
    "  if($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }"
    "  [System.IO.File]::WriteAllText($Path,$t,$enc)"
    "}"
    ""
  ) -join "`n"

  if($raw -match "function\s+Write-Utf8NoBomLf\s*\("){
    $i = $raw.IndexOf("function Write-Utf8NoBomLf")
    if($i -ge 0){
      # insert helper BEFORE Write-Utf8NoBomLf to keep small functions together
      $raw = $raw.Insert($i,$helper)
    } else {
      $raw = $helper + $raw
    }
  } else {
    $raw = $helper + $raw
  }
}

# 2) Replace blob content writes that force trailing LF.
#    We only touch calls where the target path clearly ends with "\content".
$raw2 = $raw
$raw2 = [regex]::Replace($raw2, "Write-Utf8NoBomLf\s*\(\s*([^\)]*?content[^\)]*?)\)", "Write-Utf8NoBomNoFinalLf($1)", [System.Text.RegularExpressions.RegexOptions]::Singleline)

# Write back UTF-8 no BOM LF
$enc = New-Object System.Text.UTF8Encoding($false)
$out = ($raw2 -replace "`r`n","`n") -replace "`r","`n"
if(-not $out.EndsWith("`n")){ $out += "`n" }
[System.IO.File]::WriteAllText($cap,$out,$enc)
Parse-GateFile $cap
Write-Output ("PATCHED_CAPTURE_BLOB_WRITES_OK: " + $cap)
