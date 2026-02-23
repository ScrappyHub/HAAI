param([Parameter(Mandatory=$true)][string]$RepoRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }
function EnsureDir([string]$p){ if([string]::IsNullOrWhiteSpace($p)){ Die "EnsureDir: empty" }; if(-not (Test-Path -LiteralPath $p -PathType Container)){ New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function WriteTextUtf8NoBomLf([string]$Path,[string]$Text){ $enc = New-Object System.Text.UTF8Encoding($false); $t = ($Text -replace "`r`n","`n") -replace "`r","`n"; if(-not $t.EndsWith("`n")){ $t += "`n" }; $dir = Split-Path -Parent $Path; if($dir){ EnsureDir $dir }; [System.IO.File]::WriteAllText($Path,$t,$enc) }
function Parse-GateFile([string]$Path){ if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("PARSE_GATE_MISSING: " + $Path) }; $tok=$null; $err=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tok,[ref]$err); if($err -ne $null -and $err.Count -gt 0){ $m = ($err | ForEach-Object { $_.ToString() }) -join "`n"; Die ("PARSE_GATE_FAIL: " + $Path + "`n" + $m) } }

# --- Overwrite verifier with strict byte-hash implementation ---
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$Scripts  = Join-Path $RepoRoot "scripts"
$OutPath  = Join-Path $Scripts "haai_verify_packet_optionA_v1.ps1"

$V = New-Object System.Collections.Generic.List[string]
[void]$V.Add("param([Parameter(Mandatory=`$true)][string]`$RepoRoot,[Parameter(Mandatory=`$true)][string]`$PacketDir)")
[void]$V.Add("")
[void]$V.Add("Set-StrictMode -Version Latest")
[void]$V.Add("`$ErrorActionPreference = ""Stop""")
[void]$V.Add("")
[void]$V.Add("function Fail([string]`$token,[string]`$detail){ Write-Output (`$token + "":"" + `$detail); exit 2 }")
[void]$V.Add("function Sha256HexBytes([byte[]]`$b){ `$sha = [System.Security.Cryptography.SHA256]::Create(); try{ `$h = `$sha.ComputeHash(`$b) } finally { `$sha.Dispose() }; `$sb = New-Object System.Text.StringBuilder; foreach(`$x in `$h){ [void]`$sb.AppendFormat(""{0:x2}"",[int]`$x) }; return `$sb.ToString() }")
[void]$V.Add("function ReadAllBytes([string]`$p){ return [System.IO.File]::ReadAllBytes(`$p) }")
[void]$V.Add("function ReadUtf8Trim([string]`$p){ `$enc = New-Object System.Text.UTF8Encoding(`$false); return ([System.IO.File]::ReadAllText(`$p,`$enc)).Trim() }")
[void]$V.Add("")
[void]$V.Add("`$RepoRoot = (Resolve-Path -LiteralPath `$RepoRoot).Path")
[void]$V.Add("`$PacketDir = (Resolve-Path -LiteralPath `$PacketDir).Path")
[void]$V.Add("`$manifest = Join-Path `$PacketDir ""manifest.json""")
[void]$V.Add("`$pidTxt  = Join-Path `$PacketDir ""packet_id.txt""")
[void]$V.Add("`$shaTxt  = Join-Path `$PacketDir ""sha256sums.txt""")
[void]$V.Add("if(-not (Test-Path -LiteralPath `$manifest -PathType Leaf)){ Fail ""MISSING_MANIFEST"" ""manifest.json"" }")
[void]$V.Add("if(-not (Test-Path -LiteralPath `$pidTxt  -PathType Leaf)){ Fail ""MISSING_PACKET_ID"" ""packet_id.txt"" }")
[void]$V.Add("if(-not (Test-Path -LiteralPath `$shaTxt  -PathType Leaf)){ Fail ""MISSING_SHA256SUMS"" ""sha256sums.txt"" }")
[void]$V.Add("")
[void]$V.Add("# PacketId (Option A): sha256(ON-DISK BYTES of manifest.json)")
[void]$V.Add("`$pidExpected = (ReadUtf8Trim `$pidTxt).ToLowerInvariant()")
[void]$V.Add("if(`$pidExpected -notmatch ""^[0-9a-f]{64}$""){ Fail ""BAD_PACKET_ID_FORMAT"" `$pidExpected }")
[void]$V.Add("`$pidActual = (Sha256HexBytes (ReadAllBytes `$manifest)).ToLowerInvariant()")
[void]$V.Add("if(`$pidActual -ne `$pidExpected){ Fail ""PACKET_ID_MISMATCH"" (""expected="" + `$pidExpected + "" actual="" + `$pidActual) }")
[void]$V.Add("")
[void]$V.Add("# sha256sums: hash the EXACT on-disk bytes for each referenced file")
[void]$V.Add("`$lines = Get-Content -LiteralPath `$shaTxt")
[void]$V.Add("foreach(`$ln in @(`$lines)){")
[void]$V.Add("  if([string]::IsNullOrWhiteSpace(`$ln)){ continue }")
[void]$V.Add("  if(`$ln -notmatch ""^(?<h>[0-9a-fA-F]{64})\s+(?<p>.+)$""){ Fail ""BAD_SHA256SUMS_LINE"" `$ln }")
[void]$V.Add("  `$h = `$Matches['h'].ToLowerInvariant()")
[void]$V.Add("  `$p = `$Matches['p'].Trim()")
[void]$V.Add("  # normalize path and prevent traversal")
[void]$V.Add("  `$p2 = `$p.Replace('\','/')")
[void]$V.Add("  if(`$p2.StartsWith(""/"") -or `$p2.Contains(""://"") -or `$p2 -match ""^[A-Za-z]:"" -or `$p2.Contains(""../"") -or `$p2.Contains(""/.."" )){ Fail ""PATH_TRAVERSAL_OR_ABS"" `$p }")
[void]$V.Add("  `$abs = Join-Path `$PacketDir (`$p2.Replace('/','\') )")
[void]$V.Add("  if(-not (Test-Path -LiteralPath `$abs -PathType Leaf)){ Fail ""MISSING_FILE"" `$p }")
[void]$V.Add("  `$act = (Sha256HexBytes (ReadAllBytes `$abs)).ToLowerInvariant()")
[void]$V.Add("  if(`$act -ne `$h){ Fail ""FILE_HASH_MISMATCH"" `$p }")
[void]$V.Add("}")
[void]$V.Add("Write-Output ""OK: VERIFIED_PACKET_BYTESHA""")
[void]$V.Add("exit 0")

$ver = (@($V.ToArray()) -join "`n")
WriteTextUtf8NoBomLf $OutPath $ver
Parse-GateFile $OutPath
Write-Output ("PATCHED_VERIFIER_OK: " + $OutPath)

# Rerun selftest
$PSExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$self = Join-Path $Scripts "haai_selftest_v1.ps1"
if(-not (Test-Path -LiteralPath $self -PathType Leaf)){ Die ("MISSING_SELFTEST: " + $self) }
& $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $self -RepoRoot $RepoRoot | Out-Host
if($LASTEXITCODE -ne 0){ throw ("SELFTEST_EXIT_NONZERO: " + $LASTEXITCODE) }
Write-Output "PATCH_AND_SELFTEST_OK"
