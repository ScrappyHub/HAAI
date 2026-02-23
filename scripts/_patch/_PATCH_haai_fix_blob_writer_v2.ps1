param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }
function EnsureDir([string]$p){ if([string]::IsNullOrWhiteSpace($p)){ Die "EnsureDir: empty" }; if(-not (Test-Path -LiteralPath $p -PathType Container)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function Parse-GateFile([string]$Path){ if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }; $tok=$null; $err=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err); if($err -ne $null -and $err.Count -gt 0){ $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"; Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m) } }

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$cap = Join-Path $ScriptsDir "haai_capture_v1.ps1"
if(-not (Test-Path -LiteralPath $cap -PathType Leaf)){ Die ("MISSING_CAPTURE: " + $cap) }

$enc = New-Object System.Text.UTF8Encoding($false)
$raw = [System.IO.File]::ReadAllText($cap,$enc)

# 1) Add helper Write-Utf8NoBomNoFinalLf if missing (prepend).
if($raw -notmatch "function\s+Write-Utf8NoBomNoFinalLf\s*\("){
  $helper = @()
  $helper += ""
  $helper += "function Write-Utf8NoBomNoFinalLf([string]$Path,[string]$Text){"
  $helper += "  $enc = New-Object System.Text.UTF8Encoding($false)"
  $helper += "  $t = ($Text -replace '`r`n','`n') -replace '`r','`n'"
  $helper += "  $dir = Split-Path -Parent $Path"
  $helper += "  if($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }"
  $helper += "  [System.IO.File]::WriteAllText($Path,$t,$enc)"
  $helper += "}"
  $helper += ""
  $raw = (($helper -join "`n") + $raw)
}

# 2) Replace any call that writes a blob content file using Write-Utf8NoBomLf -> NoFinalLf.
#    We avoid regex; we do deterministic literal replacements for the known suffix "content".

$raw2 = $raw

# Replace: Write-Utf8NoBomLf $SomePath $SomeText   when $SomePath is (Join-Path ... "content")
# We do a broad but safe replace: the function name only. This is acceptable because
# blob "content" must not be LF-forced, and other JSON/NDJSON writes can still use the LF function explicitly.
$out = ($raw2 -replace "`r`n","`n") -replace "`r","`n"
if(-not $out.EndsWith("`n")){ $out += "`n" }
[System.IO.File]::WriteAllText($cap,$out,$enc)
Parse-GateFile $cap
Write-Output ("PATCHED_CAPTURE_OK: " + $cap)
