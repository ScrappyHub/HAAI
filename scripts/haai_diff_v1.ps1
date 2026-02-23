param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$A_Dir,
  [Parameter(Mandatory=$true)][string]$B_Dir,
  [Parameter(Mandatory=$true)][string]$OutDiffJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $RepoRoot "scripts\_lib_haai_core_v1.ps1")

function Resolve-Envelope([string]$d){
  $p = Join-Path $d "payload\run_envelope.json"
  if(Test-Path -LiteralPath $p -PathType Leaf){ return $p }
  Die ("MISSING_RUN_ENVELOPE: " + $d)
}

$aPath = Resolve-Envelope $A_Dir
$bPath = Resolve-Envelope $B_Dir

$aTxt = Get-Content -LiteralPath $aPath -Raw
$bTxt = Get-Content -LiteralPath $bPath -Raw

$enc = New-Object System.Text.UTF8Encoding($false)
$aHash = Sha256HexBytes ($enc.GetBytes($aTxt))
$bHash = Sha256HexBytes ($enc.GetBytes($bTxt))

$out = @{
  schema="haai.diff.v1"
  time_utc=(NowUtc)
  a=@{ envelope_sha256=$aHash; path=$aPath }
  b=@{ envelope_sha256=$bHash; path=$bPath }
  same=($aHash -eq $bHash)
}

Write-Utf8NoBomLf $OutDiffJson (To-CanonJson $out)
Append-Receipt -RepoRoot $RepoRoot -Row @{
  event="haai.diff.v1"; result="ok";
  details=@{ out=$OutDiffJson; a=$aHash; b=$bHash; same=($aHash -eq $bHash) }
}

Write-Output ("OK: DIFF_WROTE: " + $OutDiffJson)
