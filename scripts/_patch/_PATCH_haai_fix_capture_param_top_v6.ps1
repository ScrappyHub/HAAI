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

function Extract-ParamBlockText([string]$Text){
  # Finds first line that begins with param( and returns the full balanced (...) text + start/end indexes.
  $m = [regex]::Match($Text, '(?m)^\s*param\s*\(')
  if(-not $m.Success){ throw "NO_PARAM_BLOCK_FOUND" }
  $start = $m.Index
  $i = $m.Index + $m.Length  # position after "param("
  $depth = 1
  while($i -lt $Text.Length){
    $ch = $Text[$i]
    if($ch -eq '('){ $depth++ }
    elseif($ch -eq ')'){ $depth--; if($depth -eq 0){ $i++; break } }
    $i++
  }
  if($depth -ne 0){ throw "PARAM_PARENS_UNBALANCED" }
  $paramText = $Text.Substring($start, ($i - $start))
  return @{ Start=$start; End=$i; Text=$paramText }
}

$RepoRoot   = (Resolve-Path -LiteralPath $RepoRoot).Path
$ScriptsDir = Join-Path $RepoRoot "scripts"
$cap        = Join-Path $ScriptsDir "haai_capture_v1.ps1"
if(-not (Test-Path -LiteralPath $cap -PathType Leaf)){ Die ("MISSING_CAPTURE: " + $cap) }

$enc = New-Object System.Text.UTF8Encoding($false)
$raw = [System.IO.File]::ReadAllText($cap,$enc)

# ---- 1) Extract param block and remove it from current location ----
$p = Extract-ParamBlockText $raw
$before = $raw.Substring(0,$p.Start)
$after  = $raw.Substring($p.End)

# Keep only leading comments/blank lines from $before (safe header)
$headerLines = New-Object System.Collections.Generic.List[string]
$blines = @($before -split "`n",0)
foreach($ln in @($blines)){
  $t = $ln.Trim()
  if($t -eq "" -or $t.StartsWith("#")){
    [void]$headerLines.Add($ln)
    continue
  }
  break
}
$header = (@($headerLines.ToArray()) -join "`n")
if(-not [string]::IsNullOrWhiteSpace($header) -and -not $header.EndsWith("`n")){ $header += "`n" }

# Remove any helper that might have been prepended above param previously
$after2 = $after
$after2 = [regex]::Replace(
  $after2,
  '(?s)^\s*function\s+Write-Utf8NoBomNoFinalLf\s*\([^\)]*\)\s*\{.*?\}\s*',
  '',
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

# ---- 2) Ensure helper exists (we will insert it AFTER param + StrictMode/EAP if present) ----
$helperLines = New-Object System.Collections.Generic.List[string]
[void]$helperLines.Add('function Write-Utf8NoBomNoFinalLf([string]$Path,[string]$Text){')
[void]$helperLines.Add('  if([string]::IsNullOrWhiteSpace($Path)){ throw "WRITE_EMPTY_PATH" }')
[void]$helperLines.Add('  $enc = New-Object System.Text.UTF8Encoding($false)')
[void]$helperLines.Add('  # normalize CRLF->LF but DO NOT force trailing LF')
[void]$helperLines.Add('  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"')
[void]$helperLines.Add('  $dir = Split-Path -Parent $Path')
[void]$helperLines.Add('  if($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)){')
[void]$helperLines.Add('    New-Item -ItemType Directory -Force -Path $dir | Out-Null')
[void]$helperLines.Add('  }')
[void]$helperLines.Add('  [System.IO.File]::WriteAllText($Path,$t,$enc)')
[void]$helperLines.Add('}')
[void]$helperLines.Add('')

$helperText = (@($helperLines.ToArray()) -join "`n")

$body = $after2

# If helper is missing anywhere, insert it after StrictMode/EAP lines if present; else right after param.
if($raw -notmatch "function\s+Write-Utf8NoBomNoFinalLf\s*\("){
  $insertPos = 0
  $m2 = [regex]::Match($body, '(?m)^\s*\$ErrorActionPreference\s*=\s*".*?"\s*$')
  if($m2.Success){
    # insert after that line
    $nl = $body.IndexOf("`n", $m2.Index + $m2.Length)
    if($nl -ge 0){ $insertPos = $nl + 1 } else { $insertPos = $body.Length }
  }
  $body = $body.Insert($insertPos, ($helperText))
}

# ---- 3) Rebuild capture file with param first ----
$newRaw = $header + $p.Text + "`n`n" + $body
$newRaw = ($newRaw -replace "`r`n","`n") -replace "`r","`n"
if(-not $newRaw.EndsWith("`n")){ $newRaw += "`n" }

WriteTextUtf8NoBomLf $cap $newRaw
Parse-GateFile $cap
Write-Output ("PATCHED_CAPTURE_PARAM_TOP_OK: " + $cap)
