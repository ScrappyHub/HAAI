param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("help","selftest","full-green","runtime-verify","docker-up","docker-down","docker-logs","runtime-probe","status")]
  [string]$Cmd,

  [string]$RepoRoot = "."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }

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
$dockerCmd = Get-Command docker.exe -ErrorAction SilentlyContinue
$docker = $null
if($dockerCmd){ $docker = $dockerCmd.Source }

$Selftest = Join-Path $RepoRoot "scripts\haai_selftest_v1.ps1"
$FullGreen = Join-Path $RepoRoot "scripts\_RUN_haai_full_green_v1.ps1"
$RuntimeVerify = Join-Path $RepoRoot "scripts\_RUN_haai_runtime_verify_v1.ps1"
$Compose = Join-Path $RepoRoot "docker-compose.haai.yml"
$Env = Join-Path $RepoRoot ".env"

Parse-GateFile $Selftest
Parse-GateFile $FullGreen
Parse-GateFile $RuntimeVerify

switch($Cmd){
        "runtime-probe" {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:54170/healthz"
    $index  = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:54170/index.json"
    if($health.StatusCode -ne 200){ Die ("HEALTH_STATUS_BAD: " + $health.StatusCode) }
    if(([string]$health.Content).Trim() -ne "ok"){ Die ("HEALTH_BODY_BAD: " + ([string]$health.Content).Trim()) }
    if($index.StatusCode -ne 200){ Die ("INDEX_STATUS_BAD: " + $index.StatusCode) }
    Write-Host ("HEALTH_OK: " + ([string]$health.Content).Trim()) -ForegroundColor Green
    Write-Host ("INDEX_OK: " + ([string]$index.Content).Trim()) -ForegroundColor Green
    Write-Host "HAAI_ENTRYPOINT_RUNTIME_PROBE_OK" -ForegroundColor Green
    break
  }

"docker-logs" {
    if([string]::IsNullOrWhiteSpace($docker)){ Die "DOCKER_NOT_FOUND" }
    & $docker logs haai_runtime 2>&1 | Out-Host
    Write-Host "HAAI_ENTRYPOINT_DOCKER_LOGS_OK" -ForegroundColor Green
    break
  }

"help" {
    Write-Host "HAAI COMMANDS" -ForegroundColor Yellow
    Write-Host "  help            show operator commands" -ForegroundColor Yellow
    Write-Host "  status          show repo/runtime status" -ForegroundColor Yellow
    Write-Host "  selftest        run canonical selftest" -ForegroundColor Yellow
    Write-Host "  full-green      run authoritative full-green runner" -ForegroundColor Yellow
    Write-Host "  runtime-verify  verify live dedicated runtime" -ForegroundColor Yellow
    Write-Host "  docker-up       build/start dedicated runtime" -ForegroundColor Yellow
    Write-Host "  docker-down     stop/remove dedicated runtime" -ForegroundColor Yellow
    Write-Host "HAAI_ENTRYPOINT_HELP_OK" -ForegroundColor Green
    break
  }

"selftest" {
    & $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Selftest -RepoRoot $RepoRoot
    if($LASTEXITCODE -ne 0){ Die ("SELFTEST_EXIT_NONZERO: " + $LASTEXITCODE) }
    Write-Host "HAAI_ENTRYPOINT_SELFTEST_GREEN" -ForegroundColor Green
    break
  }

  "full-green" {
    & $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $FullGreen -RepoRoot $RepoRoot
    if($LASTEXITCODE -ne 0){ Die ("FULL_GREEN_EXIT_NONZERO: " + $LASTEXITCODE) }
    Write-Host "HAAI_ENTRYPOINT_FULL_GREEN" -ForegroundColor Green
    break
  }

  "runtime-verify" {
    & $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $RuntimeVerify -RepoRoot $RepoRoot
    if($LASTEXITCODE -ne 0){ Die ("RUNTIME_VERIFY_EXIT_NONZERO: " + $LASTEXITCODE) }
    Write-Host "HAAI_ENTRYPOINT_RUNTIME_VERIFY_GREEN" -ForegroundColor Green
    break
  }

  "docker-up" {
    if(-not $docker){ Die "DOCKER_NOT_FOUND" }
    if(-not (Test-Path -LiteralPath $Compose -PathType Leaf)){ Die "MISSING_COMPOSE" }
    if(-not (Test-Path -LiteralPath $Env -PathType Leaf)){ Die "MISSING_ENV" }
    & $docker compose -f $Compose --env-file $Env up -d --build
    if($LASTEXITCODE -ne 0){ Die ("DOCKER_UP_EXIT_NONZERO: " + $LASTEXITCODE) }
    Write-Host "HAAI_ENTRYPOINT_DOCKER_UP_GREEN" -ForegroundColor Green
    break
  }

  "docker-down" {
    if(-not $docker){ Die "DOCKER_NOT_FOUND" }
    if(-not (Test-Path -LiteralPath $Compose -PathType Leaf)){ Die "MISSING_COMPOSE" }
    if(-not (Test-Path -LiteralPath $Env -PathType Leaf)){ Die "MISSING_ENV" }
    & $docker compose -f $Compose --env-file $Env down --remove-orphans
    if($LASTEXITCODE -ne 0){ Die ("DOCKER_DOWN_EXIT_NONZERO: " + $LASTEXITCODE) }
    Write-Host "HAAI_ENTRYPOINT_DOCKER_DOWN_GREEN" -ForegroundColor Green
    break
  }

  "status" {
    Write-Host ("REPO_ROOT: " + $RepoRoot) -ForegroundColor Yellow
    Write-Host ("SELFTEST: " + $Selftest) -ForegroundColor Yellow
    Write-Host ("FULL_GREEN: " + $FullGreen) -ForegroundColor Yellow
    Write-Host ("RUNTIME_VERIFY: " + $RuntimeVerify) -ForegroundColor Yellow
    Write-Host ("COMPOSE: " + $Compose) -ForegroundColor Yellow
    Write-Host ("ENV: " + $Env) -ForegroundColor Yellow
    Write-Host ("COMPOSE_PRESENT=" + ([string](Test-Path -LiteralPath $Compose -PathType Leaf)).ToLowerInvariant()) -ForegroundColor Green
    Write-Host ("ENV_PRESENT=" + ([string](Test-Path -LiteralPath $Env -PathType Leaf)).ToLowerInvariant()) -ForegroundColor Green
    if($docker){
      & $docker ps --filter "name=^haai_runtime$" --format "table {{.Names}}`t{{.Ports}}`t{{.Status}}`t{{.Networks}}"
    }
    Write-Host "HAAI_ENTRYPOINT_STATUS_OK" -ForegroundColor Green
    break
  }

  default {
    Die ("UNKNOWN_CMD: " + $Cmd)
  }
}
