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
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}

function Parse-GateFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }
  $tok = $null
  $err = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err)
  if($err -and $err.Count -gt 0){
    Die ("PARSE_GATE_FAIL: " + $Path + "`n" + (($err | ForEach-Object { $_.ToString() }) -join "`n"))
  }
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$PSExe = (Get-Command powershell.exe -ErrorAction Stop).Source

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmssZ")
$runDir = Join-Path $RepoRoot ("proofs\receipts\haai_full_green\" + $runId)
EnsureDir $runDir

$stdoutPath = Join-Path $runDir "stdout.txt"
$stderrPath = Join-Path $runDir "stderr.txt"
$statusPath = Join-Path $runDir "status.txt"

# Parse-gate product surface
$parseTargets = @(
  (Join-Path $RepoRoot "scripts\_lib_haai_core_v1.ps1"),
  (Join-Path $RepoRoot "scripts\haai_capture_v1.ps1"),
  (Join-Path $RepoRoot "scripts\haai_build_packet_optionA_v1.ps1"),
  (Join-Path $RepoRoot "scripts\haai_verify_packet_optionA_v1.ps1"),
  (Join-Path $RepoRoot "scripts\haai_diff_v1.ps1"),
  (Join-Path $RepoRoot "scripts\haai_selftest_v1.ps1")
)

foreach($p in @($parseTargets)){ Parse-GateFile $p }

# Verify dedicated runtime surface exists
$envPath = Join-Path $RepoRoot ".env"
$composePath = Join-Path $RepoRoot "docker-compose.haai.yml"
if(-not (Test-Path -LiteralPath $envPath -PathType Leaf)){ Die "MISSING_ENV_FILE" }
if(-not (Test-Path -LiteralPath $composePath -PathType Leaf)){ Die "MISSING_COMPOSE_FILE" }

$envText = Get-Content -LiteralPath $envPath -Raw
if($envText -notmatch '(?m)^HAAI_PORT=54170$'){ Die "ENV_PORT_NOT_LOCKED" }
if($envText -notmatch '(?m)^HAAI_BIND=127\.0\.0\.1$'){ Die "ENV_BIND_NOT_LOCKED" }
if($envText -notmatch '(?m)^COMPOSE_PROJECT_NAME=haai$'){ Die "ENV_PROJECT_NOT_LOCKED" }

$composeText = Get-Content -LiteralPath $composePath -Raw
if($composeText -notmatch '(?m)^\s*name:\s*haai\s*$'){ Die "COMPOSE_NAME_NOT_LOCKED" }
if($composeText -notmatch 'haai_net'){ Die "COMPOSE_NETWORK_NOT_LOCKED" }
if($composeText -notmatch 'haai_port_guard'){ Die "COMPOSE_CONTAINER_NOT_LOCKED" }

# Run selftest in child powershell with deterministic transcript capture
$p = Start-Process -FilePath $PSExe -ArgumentList @(
  "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
  "-File",(Join-Path $RepoRoot "scripts\haai_selftest_v1.ps1"),
  "-RepoRoot",$RepoRoot
) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -Wait -PassThru

$stdout = ""
$stderr = ""
if(Test-Path -LiteralPath $stdoutPath){ $stdout = Get-Content -LiteralPath $stdoutPath -Raw }
if(Test-Path -LiteralPath $stderrPath){ $stderr = Get-Content -LiteralPath $stderrPath -Raw }

$status = @(
  ("exit_code=" + $p.ExitCode),
  ("selftest_ok=" + ([string]($stdout -match 'SELFTEST_OK')).ToLowerInvariant()),
  ("neg_verify_expected_fail_ok=" + ([string]($stdout -match 'NEG_VERIFY_EXPECTED_FAIL_OK')).ToLowerInvariant()),
  ("port_locked=" + ([string](Test-Path -LiteralPath $envPath -PathType Leaf)).ToLowerInvariant()),
  ("compose_locked=" + ([string](Test-Path -LiteralPath $composePath -PathType Leaf)).ToLowerInvariant())
) -join "`n"
Write-Utf8NoBomLf $statusPath $status

if($p.ExitCode -ne 0){ Die ("SELFTEST_EXIT_NONZERO: " + $p.ExitCode) }
if($stdout -notmatch 'SELFTEST_OK'){ Die "SELFTEST_TOKEN_MISSING" }
if($stdout -notmatch 'NEG_VERIFY_EXPECTED_FAIL_OK'){ Die "NEGATIVE_ASSERT_TOKEN_MISSING" }

Write-Host "HAAI_FULL_GREEN" -ForegroundColor Green
Write-Host ("RUN_DIR: " + $runDir) -ForegroundColor Yellow
