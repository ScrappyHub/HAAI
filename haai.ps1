param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("selftest","full-green","runtime-verify","docker-up","docker-down","status")]
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
$docker = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source

$Selftest = Join-Path $RepoRoot "scripts\haai_selftest_v1.ps1"
$FullGreen = Join-Path $RepoRoot "scripts\_RUN_haai_full_green_v1.ps1"
$RuntimeVerify = Join-Path $RepoRoot "scripts\_RUN_haai_runtime_verify_v1.ps1"
$Compose = Join-Path $RepoRoot "docker-compose.haai.yml"
$Env = Join-Path $RepoRoot ".env"

Parse-GateFile $Selftest
Parse-GateFile $FullGreen
Parse-GateFile $RuntimeVerify

switch($Cmd){
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
    if([string]::IsNullOrWhiteSpace($docker)){ Die "DOCKER_NOT_FOUND" }
    if(-not (Test-Path -LiteralPath $Compose -PathType Leaf)){ Die "MISSING_COMPOSE" }
    if(-not (Test-Path -LiteralPath $Env -PathType Leaf)){ Die "MISSING_ENV" }

    & $docker compose -f $Compose --env-file $Env up -d --build
    if($LASTEXITCODE -ne 0){ Die ("DOCKER_UP_EXIT_NONZERO: " + $LASTEXITCODE) }

    Write-Host "HAAI_ENTRYPOINT_DOCKER_UP_GREEN" -ForegroundColor Green
    break
  }

  "docker-down" {
    if([string]::IsNullOrWhiteSpace($docker)){ Die "DOCKER_NOT_FOUND" }
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

    if(Test-Path -LiteralPath $Compose -PathType Leaf){
      Write-Host "COMPOSE_PRESENT=true" -ForegroundColor Green
    } else {
      Write-Host "COMPOSE_PRESENT=false" -ForegroundColor Red
    }

    if(Test-Path -LiteralPath $Env -PathType Leaf){
      Write-Host "ENV_PRESENT=true" -ForegroundColor Green
    } else {
      Write-Host "ENV_PRESENT=false" -ForegroundColor Red
    }

    if(-not [string]::IsNullOrWhiteSpace($docker)){
      & $docker ps --filter "name=^haai_runtime$" --format "table {{.Names}}`t{{.Ports}}`t{{.Status}}`t{{.Networks}}"
    }

    Write-Host "HAAI_ENTRYPOINT_STATUS_OK" -ForegroundColor Green
    break
  }

  default {
    Die ("UNKNOWN_CMD: " + $Cmd)
  }
}
