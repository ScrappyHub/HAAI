param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"

function Die([string]$m){ throw $m }
function EnsureDir([string]$p){
  if([string]::IsNullOrWhiteSpace($p)){ Die "EnsureDir: empty" }
  if(-not (Test-Path -LiteralPath $p -PathType Container)){
    New-Item -ItemType Directory -Force -Path $p | Out-Null
  }
}
function Parse-GateFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }
  $tok=$null; $err=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err)
  if($err -and $err.Count -gt 0){
    $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"
    Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m)
  }
}
function WriteTextUtf8NoBomLf([string]$Path,[string]$Text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}
function Sha256HexBytes([byte[]]$b){
  if($null -eq $b){ $b = @() }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $h = $sha.ComputeHash($b)
    -join ($h | ForEach-Object { $_.ToString("x2") })
  } finally { $sha.Dispose() }
}
function ReadAllBytes([string]$p){
  if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ Die ("MISSING_FILE: " + $p) }
  [System.IO.File]::ReadAllBytes($p)
}
function NormalizePid([string]$s){
  $x = ([string]$s).Trim()
  if($x -match '^(?i)sha256:\s*([0-9a-f]{64})\s*$'){ return $Matches[1].ToLowerInvariant() }
  if($x -match '^(?i)([0-9a-f]{64})\s*$'){ return $Matches[1].ToLowerInvariant() }
  Die ("BAD_PACKET_ID_TXT: " + $x)
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$ver = Join-Path (Join-Path $RepoRoot "scripts") "haai_verify_packet_optionA_v1.ps1"

$body = New-Object System.Collections.Generic.List[string]

[void]$body.Add('param(')
[void]$body.Add('  [Parameter(Mandatory=$true)][string]$RepoRoot,')
[void]$body.Add('  [Parameter(Mandatory=$true)][string]$PacketDir')
[void]$body.Add(')')
[void]$body.Add('')
[void]$body.Add('Set-StrictMode -Version Latest')
[void]$body.Add('$ErrorActionPreference="Stop"')
[void]$body.Add('')
[void]$body.Add('function Die([string]$m){ throw $m }')
[void]$body.Add('function Sha256HexBytes([byte[]]$b){ if($null -eq $b){ $b=@() }; $sha=[System.Security.Cryptography.SHA256]::Create(); try{ $h=$sha.ComputeHash($b); -join ($h | ForEach-Object { $_.ToString("x2") }) } finally { $sha.Dispose() } }')
[void]$body.Add('function ReadAllBytes([string]$p){ if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ Die ("MISSING_FILE: " + $p) }; [System.IO.File]::ReadAllBytes($p) }')
[void]$body.Add('function NormalizePid([string]$s){ $x=([string]$s).Trim(); if($x -match "^(?i)sha256:\s*([0-9a-f]{64})\s*$"){ return $Matches[1].ToLowerInvariant() }; if($x -match "^(?i)([0-9a-f]{64})\s*$"){ return $Matches[1].ToLowerInvariant() }; Die ("BAD_PACKET_ID_TXT: " + $x) }')
[void]$body.Add('')
[void]$body.Add('$RepoRoot  = (Resolve-Path -LiteralPath $RepoRoot).Path')
[void]$body.Add('$PacketDir = (Resolve-Path -LiteralPath $PacketDir).Path')
[void]$body.Add('')
[void]$body.Add('$manifest = Join-Path $PacketDir "manifest.json"')
[void]$body.Add('$pidPath  = Join-Path $PacketDir "packet_id.txt"')
[void]$body.Add('$shaPath  = Join-Path $PacketDir "sha256sums.txt"')
[void]$body.Add('if(-not (Test-Path -LiteralPath $manifest -PathType Leaf)){ Die "MISSING_MANIFEST_JSON" }')
[void]$body.Add('if(-not (Test-Path -LiteralPath $pidPath  -PathType Leaf)){ Die "MISSING_PACKET_ID_TXT" }')
[void]$body.Add('if(-not (Test-Path -LiteralPath $shaPath  -PathType Leaf)){ Die "MISSING_SHA256SUMS_TXT" }')
[void]$body.Add('')
[void]$body.Add('# 1) PacketId = SHA-256(exact on-disk manifest.json bytes)')
[void]$body.Add('$manifestBytes = ReadAllBytes $manifest')
[void]$body.Add('$expectedPid = Sha256HexBytes $manifestBytes')
[void]$body.Add('$pidTxt = [System.IO.File]::ReadAllText($pidPath,(New-Object System.Text.UTF8Encoding($false)))')
[void]$body.Add('$actualPid = NormalizePid $pidTxt')
[void]$body.Add('if($actualPid -ne $expectedPid){')
[void]$body.Add('  Write-Output ("PACKET_ID_MISMATCH:" + $actualPid + ":" + $expectedPid)')
[void]$body.Add('  throw "VERIFY_FAIL"')
[void]$body.Add('}')
[void]$body.Add('Write-Output "OK_PACKET_ID_BYTESHA"')
[void]$body.Add('')
[void]$body.Add('# 2) sha256sums: hash exact on-disk bytes for each listed file')
[void]$body.Add('$lines = Get-Content -LiteralPath $shaPath')
[void]$body.Add('foreach($ln in @($lines)){')
[void]$body.Add('  if([string]::IsNullOrWhiteSpace($ln)){ continue }')
[void]$body.Add('  if($ln -notmatch "^(?<h>[0-9a-fA-F]{64})\s+(?<p>.+)$"){')
[void]$body.Add('    Write-Output ("BAD_SHA256SUMS_LINE:" + $ln)')
[void]$body.Add('    throw "VERIFY_FAIL"')
[void]$body.Add('  }')
[void]$body.Add('  $h = $Matches["h"].ToLowerInvariant()')
[void]$body.Add('  $rel = $Matches["p"].Trim()')
[void]$body.Add('  $relWin = $rel.Replace("/","\")')
[void]$body.Add('  $abs = Join-Path $PacketDir $relWin')
[void]$body.Add('  if(-not (Test-Path -LiteralPath $abs -PathType Leaf)){')
[void]$body.Add('    Write-Output ("MISSING_FILE_FOR_SHA_LINE:" + $rel)')
[void]$body.Add('    throw "VERIFY_FAIL"')
[void]$body.Add('  }')
[void]$body.Add('  $bytes = ReadAllBytes $abs')
[void]$body.Add('  $got = Sha256HexBytes $bytes')
[void]$body.Add('  if($got -ne $h){')
[void]$body.Add('    Write-Output ("FILE_HASH_MISMATCH:" + $rel)')
[void]$body.Add('    Write-Output ("EXPECTED:" + $h)')
[void]$body.Add('    Write-Output ("ACTUAL:" + $got)')
[void]$body.Add('    throw "VERIFY_FAIL"')
[void]$body.Add('  }')
[void]$body.Add('}')
[void]$body.Add('Write-Output "OK_ALL_SHA256SUMS_LINES_MATCH"')

$out = (@($body.ToArray()) -join "`n")
$out = ($out -replace "`r`n","`n") -replace "`r","`n"
if(-not $out.EndsWith("`n")){ $out += "`n" }

WriteTextUtf8NoBomLf $ver $out
Parse-GateFile $ver
Write-Output ("OVERWROTE_VERIFIER_BYTEHASH_OK: " + $ver)
