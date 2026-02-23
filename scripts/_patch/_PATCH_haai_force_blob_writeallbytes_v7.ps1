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
function Parse-GateFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }
  $tok=$null; $err=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err)
  if($err -ne $null -and $err.Count -gt 0){
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

# Convert a TEXT expression to bytes (UTF-8, no BOM), normalize CRLF->LF, do NOT append LF
function ToUtf8BytesNoFinalLf([string]$s){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($s -replace "`r`n","`n") -replace "`r","`n"
  return $enc.GetBytes($t)
}

$RepoRoot   = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$cap        = Join-Path $ScriptsDir "haai_capture_v1.ps1"
if(-not (Test-Path -LiteralPath $cap -PathType Leaf)){ Die ("MISSING_CAPTURE: " + $cap) }

$enc = New-Object System.Text.UTF8Encoding($false)
$raw = [System.IO.File]::ReadAllText($cap,$enc)

$lines = @($raw -split "`n",0)
$outL  = New-Object System.Collections.Generic.List[string]

$patched = 0

foreach($ln in @($lines)){
  $x = $ln

  # Only touch lines that look like they're writing to a blob "content" file.
  $looksLikeContentPath = $false
  if($x -match '(?i)\\payload\\blobs\\'){ $looksLikeContentPath = $true }
  if($x -match '(?i)"content"' ){ $looksLikeContentPath = $true }
  if($x -match '(?i)\\content\b'){ $looksLikeContentPath = $true }

  if($looksLikeContentPath){

    # 1) Write-Utf8*  (common form: Write-Utf8NoBomLf <pathExpr> <textExpr>)
    $m = [regex]::Match($x, '^\s*Write-(Utf8NoBomLf|Utf8NoBomNoFinalLf|TextUtf8NoBomLf)\s+(?<path>\S+)\s+(?<text>.+?)\s*$')
    if($m.Success){
      $pathExpr = $m.Groups['path'].Value
      $textExpr = $m.Groups['text'].Value

      [void]$outL.Add('  # PATCH_V7: blob content MUST be exact bytes (no forced LF)')
      [void]$outL.Add(('  $bytes = ToUtf8BytesNoFinalLf([string]({0}))' -f $textExpr))
      [void]$outL.Add(('  [System.IO.File]::WriteAllBytes({0},$bytes)' -f $pathExpr))
      $patched++
      continue
    }

    # 2) [System.IO.File]::WriteAllText(path,text,enc)
    $m2 = [regex]::Match($x, 'WriteAllText\s*\(\s*(?<path>[^,]+)\s*,\s*(?<text>[^,]+)\s*,')
    if($m2.Success){
      $pathExpr = $m2.Groups['path'].Value.Trim()
      $textExpr = $m2.Groups['text'].Value.Trim()

      [void]$outL.Add('  # PATCH_V7: blob content MUST be exact bytes (no forced LF)')
      [void]$outL.Add(('  $bytes = ToUtf8BytesNoFinalLf([string]({0}))' -f $textExpr))
      [void]$outL.Add(('  [System.IO.File]::WriteAllBytes({0},$bytes)' -f $pathExpr))
      $patched++
      continue
    }

    # 3) Set-Content / Out-File (we can’t reliably capture the text expr; hard fail so we don’t silently stay wrong)
    if($x -match '^\s*(Set-Content|Out-File)\b'){
      throw ("BLOB_WRITE_UNSUPPORTED_LINE_FOUND_NEEDS_MANUAL_PATCH: " + $x.Trim())
    }
  }

  [void]$outL.Add($x)
}

if($patched -lt 1){
  throw "PATCH_V7_DID_NOT_FIND_ANY_BLOB_CONTENT_WRITE_LINE"
}

$out = (@($outL.ToArray()) -join "`n")
$out = ($out -replace "`r`n","`n") -replace "`r","`n"
if(-not $out.EndsWith("`n")){ $out += "`n" }

WriteTextUtf8NoBomLf $cap $out
Parse-GateFile $cap
Write-Output ("PATCHED_CAPTURE_WRITEALLBYTES_OK: " + $cap + " (patched=" + $patched + ")")
