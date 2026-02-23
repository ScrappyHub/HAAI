param([Parameter(Mandatory=$true)][string]$RepoRoot,[Parameter(Mandatory=$true)][string]$PacketDir)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$token,[string]$detail){ Write-Output ($token + ":" + $detail); exit 2 }
function Sha256HexBytes([byte[]]$b){ $sha = [System.Security.Cryptography.SHA256]::Create(); try{ $h = $sha.ComputeHash($b) } finally { $sha.Dispose() }; $sb = New-Object System.Text.StringBuilder; foreach($x in $h){ [void]$sb.AppendFormat("{0:x2}",[int]$x) }; return $sb.ToString() }
function ReadAllBytes([string]$p){ return [System.IO.File]::ReadAllBytes($p) }
function ReadUtf8Trim([string]$p){ $enc = New-Object System.Text.UTF8Encoding($false); return ([System.IO.File]::ReadAllText($p,$enc)).Trim() }

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$PacketDir = (Resolve-Path -LiteralPath $PacketDir).Path
$manifest = Join-Path $PacketDir "manifest.json"
$pidTxt  = Join-Path $PacketDir "packet_id.txt"
$shaTxt  = Join-Path $PacketDir "sha256sums.txt"
if(-not (Test-Path -LiteralPath $manifest -PathType Leaf)){ Fail "MISSING_MANIFEST" "manifest.json" }
if(-not (Test-Path -LiteralPath $pidTxt  -PathType Leaf)){ Fail "MISSING_PACKET_ID" "packet_id.txt" }
if(-not (Test-Path -LiteralPath $shaTxt  -PathType Leaf)){ Fail "MISSING_SHA256SUMS" "sha256sums.txt" }

# PacketId (Option A): sha256(ON-DISK BYTES of manifest.json)
$pidExpected = (ReadUtf8Trim $pidTxt).ToLowerInvariant()
if($pidExpected -notmatch "^[0-9a-f]{64}$"){ Fail "BAD_PACKET_ID_FORMAT" $pidExpected }
$pidActual = (Sha256HexBytes (ReadAllBytes $manifest)).ToLowerInvariant()
if($pidActual -ne $pidExpected){ Fail "PACKET_ID_MISMATCH" ("expected=" + $pidExpected + " actual=" + $pidActual) }

# sha256sums: hash the EXACT on-disk bytes for each referenced file
$lines = Get-Content -LiteralPath $shaTxt
foreach($ln in @($lines)){
  if([string]::IsNullOrWhiteSpace($ln)){ continue }
  if($ln -notmatch "^(?<h>[0-9a-fA-F]{64})\s+(?<p>.+)$"){ Fail "BAD_SHA256SUMS_LINE" $ln }
  $h = $Matches['h'].ToLowerInvariant()
  $p = $Matches['p'].Trim()
  # normalize path and prevent traversal
  $p2 = $p.Replace('\','/')
  if($p2.StartsWith("/") -or $p2.Contains("://") -or $p2 -match "^[A-Za-z]:" -or $p2.Contains("../") -or $p2.Contains("/.." )){ Fail "PATH_TRAVERSAL_OR_ABS" $p }
  $abs = Join-Path $PacketDir ($p2.Replace('/','\') )
  if(-not (Test-Path -LiteralPath $abs -PathType Leaf)){ Fail "MISSING_FILE" $p }
  $act = (Sha256HexBytes (ReadAllBytes $abs)).ToLowerInvariant()
  if($act -ne $h){ Fail "FILE_HASH_MISMATCH" $p }
}
Write-Output "OK: VERIFIED_PACKET_BYTESHA"
exit 0
