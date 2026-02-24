param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $RepoRoot "scripts\_lib_haai_core_v1.ps1")

$PSExe = (Get-Command powershell.exe -ErrorAction Stop).Source

function Run-PSFile {
  param(
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][hashtable]$Args
  )
  $argv = New-Object System.Collections.Generic.List[string]
  [void]$argv.Add("-NoProfile")
  [void]$argv.Add("-NonInteractive")
  [void]$argv.Add("-ExecutionPolicy")
  [void]$argv.Add("Bypass")
  [void]$argv.Add("-File")
  [void]$argv.Add($File)
  foreach($k in @($Args.Keys)){
    [void]$argv.Add(("-" + $k))
    [void]$argv.Add([string]$Args[$k])
  }

  $out = & $PSExe @($argv.ToArray()) 2>&1
  $out | Out-Host
  $code = [int]$LASTEXITCODE

  $isVerify = $false
  if($File -match "(?i)haai_verify_packet_optionA_v1\.ps1$"){ $isVerify = $true }

  if($isVerify -and $Args.ContainsKey("PacketDir")){
    $pd = [string]$Args["PacketDir"]
    if($pd -match "(?i)golden_negative_"){
      if($code -eq 0){ throw "VERIFY_NEGATIVE_EXPECTED_NONZERO" }
      $joined = (@($out) | ForEach-Object { "$_" }) -join "`n"
      if($joined -notmatch "FILE_HASH_MISMATCH"){ throw "VERIFY_NEGATIVE_MISSING_TOKEN_FILE_HASH_MISMATCH" }
      $global:LASTEXITCODE = 0
      return 0
    }
  }

  if($code -ne 0){ throw ("RUN_PSFILE_EXIT_NONZERO: " + $code + " file=" + $File) }
  return 0
}

$tv  = Join-Path $RepoRoot "test_vectors"
$pos = Join-Path $tv "golden_positive_01"
$cap = Join-Path $pos "capture"
$pkt = Join-Path $pos "packet"

if(Test-Path -LiteralPath $pos){ Remove-Item -LiteralPath $pos -Recurse -Force }
EnsureDir $cap

$input = @{
  producer=@{ name="haai"; version="0.1.0"; instance_id="selftest" }
  strength="evidence"
  created_utc="2026-02-22T00:00:00.000Z"
  model=@{ provider="fixture"; model_id="fixture-model" }
  messages=@(
    @{ role="system"; content="You are a deterministic test." },
    @{ role="user"; content="Say hello." }
  )
  assistant_text="hello"
}

Write-Utf8NoBomLf (Join-Path $cap "input.json") (To-CanonJson $input)

# --- positive path must exit 0 ---
$code = Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_capture_v1.ps1") -Args @{ RepoRoot=$RepoRoot; OutDir=$cap; InputJson=(Join-Path $cap "input.json") }
if($code -ne 0){ Die ("POS_CAPTURE_EXIT_NONZERO: " + $code) }

$code = Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_build_packet_optionA_v1.ps1") -Args @{ RepoRoot=$RepoRoot; CaptureDir=$cap; OutPacketDir=$pkt }
if($code -ne 0){ Die ("POS_BUILD_EXIT_NONZERO: " + $code) }

$code = Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_verify_packet_optionA_v1.ps1") -Args @{ RepoRoot=$RepoRoot; PacketDir=$pkt }
if($code -ne 0){ Die ("POS_VERIFY_EXIT_NONZERO: " + $code) }

# --- negative: tamper blob; verify MUST exit nonzero ---
$neg  = Join-Path $tv "golden_negative_01"
$pkt2 = Join-Path $neg "packet"
if(Test-Path -LiteralPath $neg){ Remove-Item -LiteralPath $neg -Recurse -Force }
EnsureDir $neg
Copy-Item -LiteralPath $pkt -Destination $pkt2 -Recurse -Force

$someBlob = Get-ChildItem -LiteralPath (Join-Path $pkt2 "payload\blobs") -Recurse -File | Sort-Object FullName | Select-Object -First 1
if($null -eq $someBlob){ Die "NEG_NO_BLOB_FOUND" }
$b = [System.IO.File]::ReadAllBytes($someBlob.FullName)
if($b.Length -lt 1){ Die "NEG_BLOB_EMPTY" }
$b[0] = ($b[0] -bxor 255)
[System.IO.File]::WriteAllBytes($someBlob.FullName,$b)

$code = Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_verify_packet_optionA_v1.ps1") -Args @{ RepoRoot=$RepoRoot; PacketDir=$pkt2 }
if($code -eq 0){ Die "NEGATIVE_VECTOR_DID_NOT_FAIL" }

Write-Output "SELFTEST_OK"
