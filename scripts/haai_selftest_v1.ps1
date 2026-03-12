param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $RepoRoot "scripts\_lib_haai_core_v1.ps1")

$PSExe = (Get-Command powershell.exe -ErrorAction Stop).Source

function Invoke-ChildNonTerm {
  param([Parameter(Mandatory=$true)][string[]]$Argv)

  $oldEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & $PSExe @($Argv) 2>&1
  $code = [int]$LASTEXITCODE
  $ErrorActionPreference = $oldEAP

  return @{
    Out  = @($out)
    Code = $code
  }
}

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

  $r = Invoke-ChildNonTerm -Argv @($argv.ToArray())
  $r.Out | Out-Host

  $isVerify = $false
  if($File -match '(?i)haai_verify_packet_optionA_v1\.ps1$'){
    $isVerify = $true
  }

  if($isVerify -and $Args.ContainsKey("PacketDir")){
    $pd = [string]$Args["PacketDir"]
    if($pd -match '(?i)golden_negative_'){
      if($r.Code -eq 0){
        Die "NEG_VERIFY_EXPECTED_NONZERO"
      }

      $joined = ((@($r.Out) | ForEach-Object { "$_" }) -join "`n")
      if($joined -notmatch 'FILE_HASH_MISMATCH'){
        Die "NEG_VERIFY_MISSING_FILE_HASH_MISMATCH"
      }

      Write-Host "NEG_VERIFY_EXPECTED_FAIL_OK" -ForegroundColor Green
      $global:LASTEXITCODE = 0
      return
    }
  }

  if($r.Code -ne 0){
    Die ("RUN_PSFILE_EXIT_NONZERO: " + $r.Code + " file=" + $File)
  }
}

$tvRepo = Join-Path $RepoRoot "test_vectors"
$tv     = Join-Path $RepoRoot "_out\selftest_vectors"

if(Test-Path -LiteralPath $tv){
  Remove-Item -LiteralPath $tv -Recurse -Force
}
EnsureDir $tv

$negSrc = Join-Path $tvRepo "golden_negative_01"
$negDst = Join-Path $tv "golden_negative_01"
if(Test-Path -LiteralPath $negSrc -PathType Container){
  Copy-Item -LiteralPath $negSrc -Destination $negDst -Recurse -Force
}

$pos = Join-Path $tv "golden_positive_01"
$cap = Join-Path $pos "capture"
$pkt = Join-Path $pos "packet"

if(Test-Path -LiteralPath $pos){
  Remove-Item -LiteralPath $pos -Recurse -Force
}
EnsureDir $cap

$input = @{
  producer = @{
    name        = "haai"
    version     = "0.1.0"
    instance_id = "selftest"
  }
  strength    = "evidence"
  created_utc = "2026-02-22T00:00:00.000Z"
  model       = @{
    provider = "fixture"
    model_id = "fixture-model"
  }
  messages    = @(
    @{ role = "system"; content = "You are a deterministic test." },
    @{ role = "user";   content = "Say hello." }
  )
  assistant_text = "hello"
}

Write-Utf8NoBomLf (Join-Path $cap "input.json") (To-CanonJson $input)

Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_capture_v1.ps1") -Args @{
  RepoRoot  = $RepoRoot
  OutDir    = $cap
  InputJson = (Join-Path $cap "input.json")
}

Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_build_packet_optionA_v1.ps1") -Args @{
  RepoRoot     = $RepoRoot
  CaptureDir   = $cap
  OutPacketDir = $pkt
}

Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_verify_packet_optionA_v1.ps1") -Args @{
  RepoRoot  = $RepoRoot
  PacketDir = $pkt
}

if(-not (Test-Path -LiteralPath $negDst -PathType Container)){
  $neg = Join-Path $tv "golden_negative_01"
  $pkt2 = Join-Path $neg "packet"
  EnsureDir $neg
  Copy-Item -LiteralPath $pkt -Destination $pkt2 -Recurse -Force

  $someBlob = Get-ChildItem -LiteralPath (Join-Path $pkt2 "payload\blobs") -Recurse -File | Sort-Object FullName | Select-Object -First 1
  if($null -eq $someBlob){
    Die "NEG_NO_BLOB_FOUND"
  }

  $b = [System.IO.File]::ReadAllBytes($someBlob.FullName)
  if($b.Length -lt 1){
    Die "NEG_BLOB_EMPTY"
  }

  $b[0] = ($b[0] -bxor 255)
  [System.IO.File]::WriteAllBytes($someBlob.FullName,$b)
  $negDst = $neg
}

Run-PSFile -File (Join-Path $RepoRoot "scripts\haai_verify_packet_optionA_v1.ps1") -Args @{
  RepoRoot  = $RepoRoot
  PacketDir = (Join-Path $negDst "packet")
}

Write-Output "SELFTEST_OK"
