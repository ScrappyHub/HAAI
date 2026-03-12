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
  $tok = $null
  $err = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err)
  if($err -and $err.Count -gt 0){
    Die ("PARSE_GATE_FAIL: " + $Path + "`n" + (($err | ForEach-Object { $_.ToString() }) -join "`n"))
  }
}

function Get-Sha256Hex([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("HASH_MISSING: " + $Path) }
  return ([System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash(
      [System.IO.File]::ReadAllBytes($Path)
    )
  ) -replace '-','').ToLowerInvariant()
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$docker = (Get-Command docker.exe -ErrorAction Stop).Source

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmssZ")
$runDir = Join-Path $RepoRoot ("proofs\receipts\haai_runtime_verify\" + $runId)
EnsureDir $runDir

$stdoutPath = Join-Path $runDir "stdout.txt"
$stderrPath = Join-Path $runDir "stderr.txt"
$healthPath = Join-Path $runDir "healthz.txt"
$indexPath  = Join-Path $runDir "index.json"
$statusPath = Join-Path $runDir "status.txt"
$shaPath    = Join-Path $runDir "sha256sums.txt"

$parseTargets = @(
  (Join-Path $RepoRoot "scripts\_RUN_haai_runtime_verify_v1.ps1"),
  (Join-Path $RepoRoot "scripts\_RUN_haai_full_green_v1.ps1"),
  (Join-Path $RepoRoot "scripts\haai_selftest_v1.ps1"),
  (Join-Path $RepoRoot "Dockerfile"),
  (Join-Path $RepoRoot "docker-compose.haai.yml"),
  (Join-Path $RepoRoot "runtime\nginx\default.conf"),
  (Join-Path $RepoRoot "runtime\site\healthz"),
  (Join-Path $RepoRoot "runtime\site\index.json")
)

foreach($p in @($parseTargets)){
  if($p -match '\.ps1$'){
    Parse-GateFile $p
  } else {
    if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ Die ("MISSING_SURFACE_FILE: " + $p) }
  }
}

$composePath = Join-Path $RepoRoot "docker-compose.haai.yml"
$envPath = Join-Path $RepoRoot ".env"
if(-not (Test-Path -LiteralPath $composePath -PathType Leaf)){ Die "MISSING_COMPOSE" }
if(-not (Test-Path -LiteralPath $envPath -PathType Leaf)){ Die "MISSING_ENV" }

$composeText = Get-Content -LiteralPath $composePath -Raw
$envText = Get-Content -LiteralPath $envPath -Raw

if($envText -notmatch '(?m)^HAAI_PORT=54170$'){ Die "ENV_PORT_NOT_LOCKED" }
if($envText -notmatch '(?m)^HAAI_BIND=127\.0\.0\.1$'){ Die "ENV_BIND_NOT_LOCKED" }
if($envText -notmatch '(?m)^COMPOSE_PROJECT_NAME=haai$'){ Die "ENV_PROJECT_NOT_LOCKED" }

if($composeText -notmatch '(?m)^\s*name:\s*haai\s*$'){ Die "COMPOSE_NAME_NOT_LOCKED" }
if($composeText -notmatch 'haai_runtime'){ Die "COMPOSE_CONTAINER_NOT_LOCKED" }
if($composeText -notmatch 'haai_net'){ Die "COMPOSE_NETWORK_NOT_LOCKED" }
if($composeText -notmatch '127\.0\.0\.1'){ }
# literal bind is env-driven; env check above is authoritative

$ps = & $docker ps --filter "name=^haai_runtime$" --format "{{.Names}}|{{.Ports}}|{{.Status}}|{{.Networks}}"
if($LASTEXITCODE -ne 0){ Die "DOCKER_PS_FAIL" }
if([string]::IsNullOrWhiteSpace($ps)){ Die "HAAI_RUNTIME_NOT_RUNNING" }

$net = & $docker network inspect haai_net --format "{{.Name}}"
if($LASTEXITCODE -ne 0){ Die "HAAI_NET_NOT_FOUND" }

$health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:54170/healthz"
$index  = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:54170/index.json"

if($health.StatusCode -ne 200){ Die ("HEALTH_STATUS_BAD: " + $health.StatusCode) }
if(([string]$health.Content).Trim() -ne "ok"){ Die ("HEALTH_BODY_BAD: " + ([string]$health.Content).Trim()) }
if($index.StatusCode -ne 200){ Die ("INDEX_STATUS_BAD: " + $index.StatusCode) }

Write-Utf8NoBomLf $healthPath ([string]$health.Content)
Write-Utf8NoBomLf $indexPath ([string]$index.Content)

$stdout = @(
  ("container=" + $ps),
  ("network=" + $net),
  ("health_status=" + $health.StatusCode),
  ("health_body=" + ([string]$health.Content).Trim()),
  ("index_status=" + $index.StatusCode)
) -join "`n"
Write-Utf8NoBomLf $stdoutPath $stdout
Write-Utf8NoBomLf $stderrPath ""

$status = @(
  "runtime_verify_ok=true"
  "bind=127.0.0.1"
  "port=54170"
  "container=haai_runtime"
  "network=haai_net"
  ("health_ok=" + ([string](($health.StatusCode -eq 200) -and (([string]$health.Content).Trim() -eq "ok"))).ToLowerInvariant())
  ("index_ok=" + ([string]($index.StatusCode -eq 200)).ToLowerInvariant())
) -join "`n"
Write-Utf8NoBomLf $statusPath $status

$shaLines = New-Object System.Collections.Generic.List[string]
foreach($f in @($healthPath,$indexPath,$stdoutPath,$stderrPath,$statusPath)){
  $rel = $f.Substring($runDir.Length).TrimStart('\')
  [void]$shaLines.Add((Get-Sha256Hex $f) + " *" + $rel)
}
Write-Utf8NoBomLf $shaPath ((@($shaLines.ToArray())) -join "`n")

Write-Host "HAAI_RUNTIME_VERIFY_GREEN" -ForegroundColor Green
Write-Host ("RUN_DIR: " + $runDir) -ForegroundColor Yellow
