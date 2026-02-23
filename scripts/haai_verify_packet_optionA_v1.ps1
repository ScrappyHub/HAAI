param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$PacketDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"

function Die([string]$m){ throw $m }
function Sha256HexBytes([byte[]]$b){ if($null -eq $b){ $b=@() }; $sha=[System.Security.Cryptography.SHA256]::Create(); try{ $h=$sha.ComputeHash($b); -join ($h | ForEach-Object { $_.ToString("x2") }) } finally { $sha.Dispose() } }
function ReadAllBytes([string]$p){ if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ Die ("MISSING_FILE: " + $p) }; [System.IO.File]::ReadAllBytes($p) }
function NormalizePid([string]$s){ $x=([string]$s).Trim(); if($x -match "^(?i)sha256:\s*([0-9a-f]{64})\s*$"){ return $Matches[1].ToLowerInvariant() }; if($x -match "^(?i)([0-9a-f]{64})\s*$"){ return $Matches[1].ToLowerInvariant() }; Die ("BAD_PACKET_ID_TXT: " + $x) }

$RepoRoot  = (Resolve-Path -LiteralPath $RepoRoot).Path
$PacketDir = (Resolve-Path -LiteralPath $PacketDir).Path

$manifest = Join-Path $PacketDir "manifest.json"
$pidPath  = Join-Path $PacketDir "packet_id.txt"
$shaPath  = Join-Path $PacketDir "sha256sums.txt"
if(-not (Test-Path -LiteralPath $manifest -PathType Leaf)){ Die "MISSING_MANIFEST_JSON" }
if(-not (Test-Path -LiteralPath $pidPath  -PathType Leaf)){ Die "MISSING_PACKET_ID_TXT" }
if(-not (Test-Path -LiteralPath $shaPath  -PathType Leaf)){ Die "MISSING_SHA256SUMS_TXT" }

# 1) PacketId = SHA-256(exact on-disk manifest.json bytes)
$manifestBytes = ReadAllBytes $manifest
$expectedPid = Sha256HexBytes $manifestBytes
$pidTxt = [System.IO.File]::ReadAllText($pidPath,(New-Object System.Text.UTF8Encoding($false)))
$actualPid = NormalizePid $pidTxt
if($actualPid -ne $expectedPid){
  Write-Output ("PACKET_ID_MISMATCH:" + $actualPid + ":" + $expectedPid)
  throw "VERIFY_FAIL"
}
Write-Output "OK_PACKET_ID_BYTESHA"

# 2) sha256sums: hash exact on-disk bytes for each listed file
$lines = Get-Content -LiteralPath $shaPath
foreach($ln in @($lines)){
  if([string]::IsNullOrWhiteSpace($ln)){ continue }
  if($ln -notmatch "^(?<h>[0-9a-fA-F]{64})\s+(?<p>.+)$"){
    Write-Output ("BAD_SHA256SUMS_LINE:" + $ln)
    throw "VERIFY_FAIL"
  }
  $h = $Matches["h"].ToLowerInvariant()
  $rel = $Matches["p"].Trim()
  $relWin = $rel.Replace("/","\")
  $abs = Join-Path $PacketDir $relWin
  if(-not (Test-Path -LiteralPath $abs -PathType Leaf)){
    Write-Output ("MISSING_FILE_FOR_SHA_LINE:" + $rel)
    throw "VERIFY_FAIL"
  }
  $bytes = ReadAllBytes $abs
  $got = Sha256HexBytes $bytes
  if($got -ne $h){
    Write-Output ("FILE_HASH_MISMATCH:" + $rel)
    Write-Output ("EXPECTED:" + $h)
    Write-Output ("ACTUAL:" + $got)
    throw "VERIFY_FAIL"
  }
}
Write-Output "OK_ALL_SHA256SUMS_LINES_MATCH"
