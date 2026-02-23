param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$CaptureDir,
  [Parameter(Mandatory=$true)][string]$OutPacketDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $RepoRoot "scripts\_lib_haai_core_v1.ps1")

if(-not (Test-Path -LiteralPath $CaptureDir -PathType Container)){ Die ("MISSING_CAPTURE_DIR: " + $CaptureDir) }
if(Test-Path -LiteralPath $OutPacketDir){ Die ("OUT_PACKET_DIR_EXISTS: " + $OutPacketDir) }

EnsureDir $OutPacketDir

$srcPayload = Join-Path $CaptureDir "payload"
$dstPayload = Join-Path $OutPacketDir "payload"
if(-not (Test-Path -LiteralPath $srcPayload -PathType Container)){ Die "CAPTURE_DIR_MISSING_PAYLOAD" }

Copy-Item -LiteralPath $srcPayload -Destination $dstPayload -Recurse -Force

# manifest files[] excludes manifest.json/packet_id.txt/sha256sums.txt
$files = @()
$all = Get-ChildItem -LiteralPath $OutPacketDir -Recurse -File
foreach($f in @($all)){
  $rel = $f.FullName.Substring($OutPacketDir.Length).TrimStart('\','/') -replace '\\','/'
  if($rel -ieq 'manifest.json'){ continue }
  if($rel -ieq 'packet_id.txt'){ continue }
  if($rel -ieq 'sha256sums.txt'){ continue }
  $files += @{
    path  = $rel
    bytes = [int64]$f.Length
    sha256 = (Sha256HexFile $f.FullName)
  }
}

$manifest = @{
  schema      = "hashcanon.manifest.v1"
  created_utc = (NowUtc)
  files       = $files
}

$mJson = To-CanonJson $manifest
$mPath = Join-Path $OutPacketDir "manifest.json"
Write-Utf8NoBomLf $mPath $mJson

$enc = New-Object System.Text.UTF8Encoding($false)
$packetId = Sha256HexBytes ([System.IO.File]::ReadAllBytes($mPath))
Write-Utf8NoBomLf (Join-Path $OutPacketDir "packet_id.txt") $packetId

# sha256sums last (includes manifest.json + packet_id.txt + payload/..., excludes sha256sums.txt)
$rows = @()
$final = Get-ChildItem -LiteralPath $OutPacketDir -Recurse -File
foreach($f in @($final)){
  $rel = $f.FullName.Substring($OutPacketDir.Length).TrimStart('\','/') -replace '\\','/'
  if($rel -ieq 'sha256sums.txt'){ continue }
  $rows += ((Sha256HexFile $f.FullName) + "  " + $rel)
}
$rows = @($rows | Sort-Object)
Write-Utf8NoBomLf (Join-Path $OutPacketDir "sha256sums.txt") ($rows -join "`n")

Append-Receipt -RepoRoot $RepoRoot -Row @{
  event  = "haai.packet.built.v1"
  result = "ok"
  details = @{
    packet_dir      = $OutPacketDir
    packet_id       = $packetId
    manifest_sha256 = (Sha256HexFile (Join-Path $OutPacketDir "manifest.json"))
    sha256sums_sha256 = (Sha256HexFile (Join-Path $OutPacketDir "sha256sums.txt"))
  }
}

Write-Output ("OK: BUILT_PACKET: " + $OutPacketDir)
