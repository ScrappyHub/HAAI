param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"

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
function WriteTextUtf8NoBomLf([string]$Path,[string]$Text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}

$RepoRoot   = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$self      = Join-Path $ScriptsDir "haai_selftest_v1.ps1"
if(-not (Test-Path -LiteralPath $self -PathType Leaf)){ Die ("MISSING_SELFTEST: " + $self) }

$enc = New-Object System.Text.UTF8Encoding($false)
$raw = [System.IO.File]::ReadAllText($self,$enc)

# 1) Ensure verify call index counter exists (once)
if($raw -notmatch '(?m)^\s*\$verifyCallIndex\s*=\s*0\s*$'){
  if($raw -match '(?m)^\s*Set-StrictMode\b.*$'){
    # insert after first Set-StrictMode line
    $raw = [regex]::Replace(
      $raw,
      '(?m)^(?<ln>\s*Set-StrictMode\b.*)$',
      '${ln}' + "`n`$verifyCallIndex = 0",
      1
    )
  } else {
    $raw = "`$verifyCallIndex = 0`n" + $raw
  }
}

# 2) Replace the verifier invocation line with an exit-code aware wrapper.
#    We patch the exact common pattern your file shows at line ~28:
#      & $PSExe @($argv.ToArray()) 2>&1 | Out-Host
$needle = '(?m)^\s*&\s*\$PSExe\s*@\(\s*\$argv\.ToArray\(\)\s*\)\s*2>&1\s*\|\s*Out-Host\s*$'
if($raw -notmatch $needle){
  throw "SELFTEST_PATCH_V1_NEEDLE_NOT_FOUND: expected verifier invocation line was not found"
}

$replacement = @"
  `$verifyCallIndex++
  `$out = & `$PSExe @(`$argv.ToArray()) 2>&1
  `$out | Out-Host
  `$code = `$LASTEXITCODE

  if(`$verifyCallIndex -eq 1){
    if(`$code -ne 0){ throw ("VERIFY_POSITIVE_EXIT_NONZERO: " + `$code) }
  } else {
    # Call #2 (and any later) is expected to be a NEGATIVE vector verify.
    if(`$code -eq 0){ throw "VERIFY_NEGATIVE_EXPECTED_NONZERO" }

    `$joined = (@(`$out) | ForEach-Object { "`$_" }) -join "`n"
    if(`$joined -notmatch 'FILE_HASH_MISMATCH'){
      throw "VERIFY_NEGATIVE_MISSING_TOKEN_FILE_HASH_MISMATCH"
    }

    # Normalize so the selftest can continue and succeed overall.
    `$global:LASTEXITCODE = 0
  }
"@

$raw = [regex]::Replace($raw, $needle, $replacement, 1)

WriteTextUtf8NoBomLf $self $raw
Parse-GateFile $self
Write-Output ("PATCHED_SELFTEST_EXPECT_NEGATIVE_FAIL_OK: " + $self)
