param([Parameter(Mandatory=$true)][string]$RepoRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"

function Die([string]$m){ throw $m }
function EnsureDir([string]$Path){
  if([string]::IsNullOrWhiteSpace($Path)){ Die "EnsureDir: empty path" }
  if(-not (Test-Path -LiteralPath $Path -PathType Container)){ New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}
function Write-Utf8NoBomLf([string]$Path,[string]$Text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
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

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$DocsDir    = Join-Path $RepoRoot "docs"
$SchemasDir = Join-Path $RepoRoot "schemas"
$ScriptsDir = Join-Path $RepoRoot "scripts"
$ProofsDir  = Join-Path $RepoRoot "proofs"
$RcptDir    = Join-Path $ProofsDir "receipts"
$TvDir      = Join-Path $RepoRoot "test_vectors"
EnsureDir $DocsDir; EnsureDir $SchemasDir; EnsureDir $ScriptsDir; EnsureDir $RcptDir; EnsureDir $TvDir
EnsureDir (Join-Path $RepoRoot "payload")

# -------------------------------------------------------------
# README + SPEC
# -------------------------------------------------------------
$Readme = New-Object System.Collections.Generic.List[string]
[void]$Readme.Add("# HAAI — Hash Access Artificial Interface")
[void]$Readme.Add("")
[void]$Readme.Add("Tier-0 deterministic AI evidence recorder + packet producer.")
[void]$Readme.Add("")
[void]$Readme.Add("## What this project is to spec")
[void]$Readme.Add("- HAAI records AI interactions/agent runs as cryptographically verifiable evidence.")
[void]$Readme.Add("- HAAI Core NEVER judges truth/quality/safety; it only captures, canonicalizes, hashes, packages, verifies, and diffs.")
[void]$Readme.Add("- APV (separate project) is the independent validator authority.")
[void]$Readme.Add("")
[void]$Readme.Add("## Transport")
[void]$Readme.Add("- Packet Constitution v1 Option A (directory bundle)")
[void]$Readme.Add("  - manifest.json MUST NOT contain packet_id")
[void]$Readme.Add("  - packet_id.txt = SHA-256(canonical manifest bytes)")
[void]$Readme.Add("")
[void]$Readme.Add("## Namespace")
[void]$Readme.Add("- Signature namespace: haai/packet")
[void]$Readme.Add("")
[void]$Readme.Add("## Commands (Tier-0)")
[void]$Readme.Add("- scripts\\haai_capture_v1.ps1")
[void]$Readme.Add("- scripts\\haai_build_packet_optionA_v1.ps1")
[void]$Readme.Add("- scripts\\haai_verify_packet_optionA_v1.ps1")
[void]$Readme.Add("- scripts\\haai_diff_v1.ps1")
[void]$Readme.Add("- scripts\\haai_selftest_v1.ps1")
Write-Utf8NoBomLf (Join-Path $RepoRoot "README.md") (($Readme.ToArray()) -join "`n")

$Spec = New-Object System.Collections.Generic.List[string]
[void]$Spec.Add("# HAAI SPEC v1 (Tier-0)")
[void]$Spec.Add("")
[void]$Spec.Add("## Canonical artifact")
[void]$Spec.Add("- payload/run_envelope.json : schema haai.run_envelope.v1")
[void]$Spec.Add("- payload/blobs/<sha256>/content : content-addressed blobs")
[void]$Spec.Add("")
[void]$Spec.Add("## Receipts")
[void]$Spec.Add("- proofs/receipts/haai.ndjson : append-only canonical NDJSON receipts")
[void]$Spec.Add("- events: haai.capture.v1, haai.packet.built.v1, haai.packet.verified.v1, haai.diff.v1")
[void]$Spec.Add("")
[void]$Spec.Add("## Packet Constitution v1 Option A layout")
[void]$Spec.Add("packet_root/")
[void]$Spec.Add("  manifest.json (no packet_id)")
[void]$Spec.Add("  packet_id.txt (sha256 of canonical manifest bytes)")
[void]$Spec.Add("  sha256sums.txt (generated last)")
[void]$Spec.Add("  payload/...")
[void]$Spec.Add("  proofs/receipts/haai.ndjson")
Write-Utf8NoBomLf (Join-Path $DocsDir "SPEC_TIER0_v1.md") (($Spec.ToArray()) -join "`n")

# -------------------------------------------------------------
# schemas (minimal placeholders; APV will enforce stricter later)
# -------------------------------------------------------------
$SchemaRun = '{' + "`n" +
  '  "properties": {' + "`n" +
  '    "schema": {"const":"haai.receipt.v1"},' + "`n" +
  '    "event": {"type":"string"},' + "`n" +
  '    "time_utc": {"type":"string"},' + "`n" +
  '    "result": {"enum":["ok","fail"]},' + "`n" +
  '    "error_code": {"type":"string"},' + "`n" +
  '    "details": {"type":"object"}' + "`n" +
  '  }' + "`n" +
  '}'
Write-Utf8NoBomLf (Join-Path $SchemasDir "haai.receipt.v1.schema.json") $SchemaReceipt

# -------------------------------------------------------------
# scripts/_lib_haai_core_v1.ps1
# -------------------------------------------------------------
$LibPath = Join-Path $ScriptsDir "_lib_haai_core_v1.ps1"
$L = New-Object System.Collections.Generic.List[string]
[void]$L.Add("Set-StrictMode -Version Latest")
[void]$L.Add("$ErrorActionPreference = ""Stop""")
[void]$L.Add("")
[void]$L.Add("function Die([string]$m){ throw $m }")
[void]$L.Add("function EnsureDir([string]$Path){ if([string]::IsNullOrWhiteSpace($Path)){ Die ""EnsureDir: empty"" }; if(-not (Test-Path -LiteralPath $Path -PathType Container)){ New-Item -ItemType Directory -Force -Path $Path | Out-Null } }")
[void]$L.Add("function Write-Utf8NoBomLf([string]$Path,[string]$Text){ $enc = New-Object System.Text.UTF8Encoding($false); $t = ($Text -replace ""`r`n"",""`n"") -replace ""`r"",""`n""; if(-not $t.EndsWith(""`n"")){ $t += ""`n"" }; $dir = Split-Path -Parent $Path; if($dir){ EnsureDir $dir }; [System.IO.File]::WriteAllText($Path,$t,$enc) }")
[void]$L.Add("function Sha256HexBytes([byte[]]$Bytes){ if($null -eq $Bytes){ Die ""SHA256_NULL_BYTES"" }; $sha=[System.Security.Cryptography.SHA256]::Create(); try{ $h=$sha.ComputeHash($Bytes) } finally { $sha.Dispose() }; $sb=New-Object System.Text.StringBuilder; foreach($b in $h){ [void]$sb.Append($b.ToString(""x2"")) }; $sb.ToString() }")
[void]$L.Add("function Sha256HexFile([string]$Path){ if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die (""MISSING_FILE: "" + $Path) }; $bytes=[System.IO.File]::ReadAllBytes($Path); Sha256HexBytes $bytes }")
[void]$L.Add("function Escape-JsonString([string]$s){ if($null -eq $s){ return """" }; $sb=New-Object System.Text.StringBuilder; foreach($ch in $s.ToCharArray()){ $c=[int][char]$ch; if($c -eq 34){ [void]$sb.Append('\"') } elseif($c -eq 92){ [void]$sb.Append('\\') } elseif($c -eq 8){ [void]$sb.Append('\b') } elseif($c -eq 12){ [void]$sb.Append('\f') } elseif($c -eq 10){ [void]$sb.Append('\n') } elseif($c -eq 13){ [void]$sb.Append('\r') } elseif($c -eq 9){ [void]$sb.Append('\t') } elseif($c -lt 32){ [void]$sb.Append((""\\u{0:x4}"" -f $c)) } else { [void]$sb.Append([char]$c) } }; $sb.ToString() }")
[void]$L.Add("function To-CanonJson([object]$v){ if($null -eq $v){ return ""null"" }; if($v -is [bool]){ return ($(if($v){ ""true"" } else { ""false"" })) }; if($v -is [string]){ return ('""' + (Escape-JsonString $v) + '""') }; if($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]){ return ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, ""{0}"", $v)) }; if($v -is [System.Collections.IDictionary]){ $keys=@($v.Keys | ForEach-Object { [string]$_ } | Sort-Object); $parts=New-Object System.Collections.Generic.List[string]; foreach($k in $keys){ $val=$v[$k]; [void]$parts.Add(('""' + (Escape-JsonString $k) + '"":' + (To-CanonJson $val))) }; return ('{' + (($parts.ToArray()) -join ',') + '}') }; if($v -is [System.Collections.IEnumerable] -and -not ($v -is [string])){ $parts=New-Object System.Collections.Generic.List[string]; foreach($it in $v){ [void]$parts.Add((To-CanonJson $it)) }; return ('[' + (($parts.ToArray()) -join ',') + ']') }; $props=@{}; foreach($p in $v.PSObject.Properties){ if($p.MemberType -eq ""NoteProperty"" -or $p.MemberType -eq ""Property""){ $props[$p.Name]=$p.Value } }; return (To-CanonJson $props) }")
[void]$L.Add("function NowUtc(){ [DateTime]::UtcNow.ToString(""yyyy-MM-ddTHH:mm:ss.fffZ"") }")
[void]$L.Add("function Append-Receipt([string]$RepoRoot,[hashtable]$Row){ $p=Join-Path $RepoRoot ""proofs\receipts\haai.ndjson""; $Row[""schema""]=""haai.receipt.v1""; if(-not $Row.ContainsKey(""time_utc"")){ $Row[""time_utc""]=(NowUtc) }; $line=(To-CanonJson $Row); $enc=New-Object System.Text.UTF8Encoding($false); $dir=Split-Path -Parent $p; if($dir){ EnsureDir $dir }; if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ [System.IO.File]::WriteAllText($p, ($line + ""`n""), $enc) } else { [System.IO.File]::AppendAllText($p, ($line + ""`n""), $enc) } }")
[void]$L.Add("function CanonBytesFromObject([object]$obj){ $json=(To-CanonJson $obj); $enc=New-Object System.Text.UTF8Encoding($false); return $enc.GetBytes($json) }")
Write-Utf8NoBomLf $LibPath (($L.ToArray()) -join "`n")
Parse-GateFile $LibPath

# -------------------------------------------------------------
# scripts/haai_capture_v1.ps1
# -------------------------------------------------------------
$CapPath = Join-Path $ScriptsDir "haai_capture_v1.ps1"
$C = New-Object System.Collections.Generic.List[string]
[void]$C.Add("param([Parameter(Mandatory=$true)][string]$RepoRoot,[Parameter(Mandatory=$true)][string]$OutDir,[Parameter(Mandatory=$true)][string]$InputJson)")
[void]$C.Add("Set-StrictMode -Version Latest")
[void]$C.Add("$ErrorActionPreference = ""Stop""")
[void]$C.Add(". (Join-Path $RepoRoot ""scripts\_lib_haai_core_v1.ps1"")")
[void]$C.Add("if(-not (Test-Path -LiteralPath $InputJson -PathType Leaf)){ Die (""MISSING_INPUT_JSON: "" + $InputJson) }")
[void]$C.Add("EnsureDir $OutDir")
[void]$C.Add("$raw = Get-Content -LiteralPath $InputJson -Raw")
[void]$C.Add("$obj = $raw | ConvertFrom-Json")
[void]$C.Add("$producer = $obj.producer; if($null -eq $producer){ Die ""CAPTURE_MISSING_PRODUCER"" }")
[void]$C.Add("$enc = New-Object System.Text.UTF8Encoding($false)")
[void]$C.Add("$messagesJson = To-CanonJson $obj.messages")
[void]$C.Add("$messagesBytes = $enc.GetBytes($messagesJson)")
[void]$C.Add("$messagesSha = Sha256HexBytes $messagesBytes")
[void]$C.Add("$messagesPath = Join-Path $OutDir (""payload\blobs\{0}\content"" -f $messagesSha)")
[void]$C.Add("EnsureDir (Split-Path -Parent $messagesPath)")
[void]$C.Add("[System.IO.File]::WriteAllBytes($messagesPath, $messagesBytes)")
[void]$C.Add("$assistantText = [string]$obj.assistant_text")
[void]$C.Add("$assistantBytes = $enc.GetBytes($assistantText)")
[void]$C.Add("$assistantSha = Sha256HexBytes $assistantBytes")
[void]$C.Add("$assistantPath = Join-Path $OutDir (""payload\blobs\{0}\content"" -f $assistantSha)")
[void]$C.Add("EnsureDir (Split-Path -Parent $assistantPath)")
[void]$C.Add("[System.IO.File]::WriteAllBytes($assistantPath, $assistantBytes)")
[void]$C.Add("$run = @{ schema=""haai.run_envelope.v1""; created_utc=(NowUtc); producer=@{ name=[string]$producer.name; version=[string]$producer.version; instance_id=[string]$producer.instance_id }; strength=($(if($obj.strength){ [string]$obj.strength } else { ""evidence"" })); model=$obj.model; inputs=@{ messages_ref=(" "sha256:"" + $messagesSha) }; outputs=@{ assistant_message_ref=(" "sha256:"" + $assistantSha) }; links=@{ prev_run_refs=@() } }")
[void]$C.Add("$runJson = To-CanonJson $run")
[void]$C.Add("Write-Utf8NoBomLf (Join-Path $OutDir ""payload\run_envelope.json"") $runJson")
[void]$C.Add("$runHash = Sha256HexBytes ($enc.GetBytes($runJson))")
[void]$C.Add("Append-Receipt -RepoRoot $RepoRoot -Row @{ event=""haai.capture.v1""; result=""ok""; details=@{ out_dir=$OutDir; run_envelope_sha256=$runHash; messages_sha256=$messagesSha; assistant_sha256=$assistantSha } }")
[void]$C.Add("Write-Output (""OK: CAPTURED: out="" + $OutDir)")
Write-Utf8NoBomLf $CapPath (($C.ToArray()) -join "`n")
Parse-GateFile $CapPath

# -------------------------------------------------------------
# scripts/haai_build_packet_optionA_v1.ps1
# -------------------------------------------------------------
$BuildPath = Join-Path $ScriptsDir "haai_build_packet_optionA_v1.ps1"
$P = New-Object System.Collections.Generic.List[string]
[void]$P.Add("param([Parameter(Mandatory=$true)][string]$RepoRoot,[Parameter(Mandatory=$true)][string]$CaptureDir,[Parameter(Mandatory=$true)][string]$OutPacketDir)")
[void]$P.Add("Set-StrictMode -Version Latest")
[void]$P.Add("$ErrorActionPreference = ""Stop""")
[void]$P.Add(". (Join-Path $RepoRoot ""scripts\_lib_haai_core_v1.ps1"")")
[void]$P.Add("if(-not (Test-Path -LiteralPath $CaptureDir -PathType Container)){ Die (""MISSING_CAPTURE_DIR: "" + $CaptureDir) }")
[void]$P.Add("if(Test-Path -LiteralPath $OutPacketDir){ Die (""OUT_PACKET_DIR_EXISTS: "" + $OutPacketDir) }")
[void]$P.Add("EnsureDir $OutPacketDir")
[void]$P.Add("$srcPayload = Join-Path $CaptureDir ""payload""")
[void]$P.Add("$dstPayload = Join-Path $OutPacketDir ""payload""")
[void]$P.Add("if(-not (Test-Path -LiteralPath $srcPayload -PathType Container)){ Die ""CAPTURE_DIR_MISSING_PAYLOAD"" }")
[void]$P.Add("Copy-Item -LiteralPath $srcPayload -Destination $dstPayload -Recurse -Force")
[void]$P.Add("$files = @()")
[void]$P.Add("$all = Get-ChildItem -LiteralPath $OutPacketDir -Recurse -File")
[void]$P.Add("foreach($f in $all){ $rel = $f.FullName.Substring($OutPacketDir.Length).TrimStart('\','/') -replace '\','/'
  if($rel -ieq 'manifest.json'){ continue }
  if($rel -ieq 'packet_id.txt'){ continue }
  if($rel -ieq 'sha256sums.txt'){ continue }
  $files += @{ path=$rel; bytes=[int64]$f.Length; sha256=(Sha256HexFile $f.FullName) }
}")
[void]$P.Add("$manifest = @{ schema=""hashcanon.manifest.v1""; created_utc=(NowUtc); files=$files }")
[void]$P.Add("$mJson = To-CanonJson $manifest")
[void]$P.Add("Write-Utf8NoBomLf (Join-Path $OutPacketDir ""manifest.json"") $mJson")
[void]$P.Add("$enc = New-Object System.Text.UTF8Encoding($false)")
[void]$P.Add("$pid = Sha256HexBytes ($enc.GetBytes($mJson))")
[void]$P.Add("Write-Utf8NoBomLf (Join-Path $OutPacketDir ""packet_id.txt"") ($pid)")
[void]$P.Add("$rows=@()")
[void]$P.Add("$final = Get-ChildItem -LiteralPath $OutPacketDir -Recurse -File")
[void]$P.Add("foreach($f in $final){ $rel = $f.FullName.Substring($OutPacketDir.Length).TrimStart('\','/') -replace '\','/'
  if($rel -ieq 'sha256sums.txt'){ continue }
  $rows += ((Sha256HexFile $f.FullName) + '  ' + $rel)
}")
[void]$P.Add("$rows = @($rows | Sort-Object)")
[void]$P.Add("Write-Utf8NoBomLf (Join-Path $OutPacketDir ""sha256sums.txt"") (($rows -join ""`n""))")
[void]$P.Add("Append-Receipt -RepoRoot $RepoRoot -Row @{ event=""haai.packet.built.v1""; result=""ok""; details=@{ packet_dir=$OutPacketDir; packet_id=$pid; manifest_sha256=(Sha256HexFile (Join-Path $OutPacketDir ""manifest.json"")); sha256sums_sha256=(Sha256HexFile (Join-Path $OutPacketDir ""sha256sums.txt"")) } }")
[void]$P.Add("Write-Output (""OK: BUILT_PACKET: "" + $OutPacketDir)")
Write-Utf8NoBomLf $BuildPath (($P.ToArray()) -join "`n")
Parse-GateFile $BuildPath

# -------------------------------------------------------------
# scripts/haai_verify_packet_optionA_v1.ps1
# -------------------------------------------------------------
$VerifyPath = Join-Path $ScriptsDir "haai_verify_packet_optionA_v1.ps1"
$V = New-Object System.Collections.Generic.List[string]
[void]$V.Add("param([Parameter(Mandatory=$true)][string]$RepoRoot,[Parameter(Mandatory=$true)][string]$PacketDir)")
[void]$V.Add("Set-StrictMode -Version Latest")
[void]$V.Add("$ErrorActionPreference = ""Stop""")
[void]$V.Add(". (Join-Path $RepoRoot ""scripts\_lib_haai_core_v1.ps1"")")
[void]$V.Add("if(-not (Test-Path -LiteralPath $PacketDir -PathType Container)){ Die (""MISSING_PACKET_DIR: "" + $PacketDir) }")
[void]$V.Add("$m = Join-Path $PacketDir ""manifest.json""")
[void]$V.Add("$p = Join-Path $PacketDir ""packet_id.txt""")
[void]$V.Add("$s = Join-Path $PacketDir ""sha256sums.txt""")
[void]$V.Add("if(-not (Test-Path -LiteralPath $m -PathType Leaf)){ Die ""MISSING_manifest.json"" }")
[void]$V.Add("if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ Die ""MISSING_packet_id.txt"" }")
[void]$V.Add("if(-not (Test-Path -LiteralPath $s -PathType Leaf)){ Die ""MISSING_sha256sums.txt"" }")
[void]$V.Add("$mBytes = [System.IO.File]::ReadAllBytes($m)")
[void]$V.Add("$pidActual = Sha256HexBytes $mBytes")
[void]$V.Add("$pidExpected = (Get-Content -LiteralPath $p -Raw).Trim()")
[void]$V.Add("if($pidActual -ne $pidExpected){ Append-Receipt -RepoRoot $RepoRoot -Row @{ event=""haai.packet.verified.v1""; result=""fail""; error_code=""PACKET_ID_MISMATCH""; details=@{ expected=$pidExpected; actual=$pidActual; packet_dir=$PacketDir } }; Die (""PACKET_ID_MISMATCH: expected="" + $pidExpected + "" actual="" + $pidActual) }")
[void]$V.Add("$lines = @((Get-Content -LiteralPath $s) | Where-Object { $_ -and $_.Trim().Length -gt 0 })")
[void]$V.Add("foreach($ln in $lines){")
[void]$V.Add("  $m2 = [regex]::Match($ln, '^([0-9a-f]{64})\s\s(.+)$')")
[void]$V.Add("  if(-not $m2.Success){ Die (""BAD_SHA256SUMS_LINE: "" + $ln) }")
[void]$V.Add("  $h = $m2.Groups[1].Value")
[void]$V.Add("  $rel = $m2.Groups[2].Value")
[void]$V.Add("  $full = Join-Path $PacketDir ($rel -replace '/','\')")
[void]$V.Add("  if(-not (Test-Path -LiteralPath $full -PathType Leaf)){ Die (""SHA256SUMS_MISSING_FILE: "" + $rel) }")
[void]$V.Add("  $hh = Sha256HexFile $full")
[void]$V.Add("  if($hh -ne $h){ Append-Receipt -RepoRoot $RepoRoot -Row @{ event=""haai.packet.verified.v1""; result=""fail""; error_code=""FILE_HASH_MISMATCH""; details=@{ file=$rel; expected=$h; actual=$hh; packet_dir=$PacketDir } }; Die (""FILE_HASH_MISMATCH: "" + $rel) }")
[void]$V.Add("}")
[void]$V.Add("Append-Receipt -RepoRoot $RepoRoot -Row @{ event=""haai.packet.verified.v1""; result=""ok""; details=@{ packet_dir=$PacketDir; packet_id=$pidActual; sha256sums_sha256=(Sha256HexFile $s) } }")
[void]$V.Add("Write-Output (""OK: VERIFIED_PACKET: "" + $PacketDir)")
Write-Utf8NoBomLf $VerifyPath (($V.ToArray()) -join "`n")
Parse-GateFile $VerifyPath

# -------------------------------------------------------------
# scripts/haai_diff_v1.ps1
# -------------------------------------------------------------
$DiffPath = Join-Path $ScriptsDir "haai_diff_v1.ps1"
$D = New-Object System.Collections.Generic.List[string]
[void]$D.Add("param([Parameter(Mandatory=$true)][string]$RepoRoot,[Parameter(Mandatory=$true)][string]$A_Dir,[Parameter(Mandatory=$true)][string]$B_Dir,[Parameter(Mandatory=$true)][string]$OutDiffJson)")
[void]$D.Add("Set-StrictMode -Version Latest")
[void]$D.Add("$ErrorActionPreference = ""Stop""")
[void]$D.Add(". (Join-Path $RepoRoot ""scripts\_lib_haai_core_v1.ps1"")")
[void]$D.Add("function Resolve-Envelope([string]$d){ $p = Join-Path $d ""payload\run_envelope.json""; if(Test-Path -LiteralPath $p -PathType Leaf){ return $p }; Die (""MISSING_RUN_ENVELOPE: "" + $d) }")
[void]$D.Add("$aPath = Resolve-Envelope $A_Dir")
[void]$D.Add("$bPath = Resolve-Envelope $B_Dir")
[void]$D.Add("$aTxt = Get-Content -LiteralPath $aPath -Raw")
[void]$D.Add("$bTxt = Get-Content -LiteralPath $bPath -Raw")
[void]$D.Add("$enc = New-Object System.Text.UTF8Encoding($false)")
[void]$D.Add("$aHash = Sha256HexBytes ($enc.GetBytes($aTxt))")
[void]$D.Add("$bHash = Sha256HexBytes ($enc.GetBytes($bTxt))")
[void]$D.Add("$out = @{ schema=""haai.diff.v1""; time_utc=(NowUtc); a=@{ envelope_sha256=$aHash; path=$aPath }; b=@{ envelope_sha256=$bHash; path=$bPath }; same=($aHash -eq $bHash) }")
[void]$D.Add("Write-Utf8NoBomLf $OutDiffJson (To-CanonJson $out)")
[void]$D.Add("Append-Receipt -RepoRoot $RepoRoot -Row @{ event=""haai.diff.v1""; result=""ok""; details=@{ out=$OutDiffJson; a=$aHash; b=$bHash; same=($aHash -eq $bHash) } }")
[void]$D.Add("Write-Output (""OK: DIFF_WROTE: "" + $OutDiffJson)")
Write-Utf8NoBomLf $DiffPath (($D.ToArray()) -join "`n")
Parse-GateFile $DiffPath

# -------------------------------------------------------------
# scripts/haai_selftest_v1.ps1
# -------------------------------------------------------------
$SelfPath = Join-Path $ScriptsDir "haai_selftest_v1.ps1"
$S = New-Object System.Collections.Generic.List[string]
[void]$S.Add("param([Parameter(Mandatory=$true)][string]$RepoRoot)")
[void]$S.Add("Set-StrictMode -Version Latest")
[void]$S.Add("$ErrorActionPreference = ""Stop""")
[void]$S.Add(". (Join-Path $RepoRoot ""scripts\_lib_haai_core_v1.ps1"")")
[void]$S.Add("$PSExe = (Get-Command powershell.exe -ErrorAction Stop).Source")
[void]$S.Add("$tv = Join-Path $RepoRoot ""test_vectors""; EnsureDir $tv")
[void]$S.Add("$pos = Join-Path $tv ""golden_positive_01""")
[void]$S.Add("$cap = Join-Path $pos ""capture""")
[void]$S.Add("$pkt = Join-Path $pos ""packet""")
[void]$S.Add("if(Test-Path -LiteralPath $pos){ Remove-Item -LiteralPath $pos -Recurse -Force }")
[void]$S.Add("EnsureDir $cap")
[void]$S.Add("$input = @{ producer=@{ name=""haai""; version=""0.1.0""; instance_id=""selftest"" }; strength=""evidence""; created_utc=""2026-02-22T00:00:00.000Z""; model=@{ provider=""fixture""; model_id=""fixture-model"" }; messages=@(@{ role=""system""; content=""You are a deterministic test."" }, @{ role=""user""; content=""Say hello."" }); assistant_text=""hello"" }")
[void]$S.Add("Write-Utf8NoBomLf (Join-Path $cap ""input.json"") (To-CanonJson $input)")
[void]$S.Add("& $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $RepoRoot ""scripts\haai_capture_v1.ps1"") -RepoRoot $RepoRoot -OutDir $cap -InputJson (Join-Path $cap ""input.json"") | Out-Host")
[void]$S.Add("& $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $RepoRoot ""scripts\haai_build_packet_optionA_v1.ps1"") -RepoRoot $RepoRoot -CaptureDir $cap -OutPacketDir $pkt | Out-Host")
[void]$S.Add("& $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $RepoRoot ""scripts\haai_verify_packet_optionA_v1.ps1"") -RepoRoot $RepoRoot -PacketDir $pkt | Out-Host")
[void]$S.Add("$neg = Join-Path $tv ""golden_negative_01""")
[void]$S.Add("$pkt2 = Join-Path $neg ""packet""")
[void]$S.Add("if(Test-Path -LiteralPath $neg){ Remove-Item -LiteralPath $neg -Recurse -Force }")
[void]$S.Add("EnsureDir $neg")
[void]$S.Add("Copy-Item -LiteralPath $pkt -Destination $pkt2 -Recurse -Force")
[void]$S.Add("$someBlob = Get-ChildItem -LiteralPath (Join-Path $pkt2 ""payload\blobs"") -Recurse -File | Sort-Object FullName | Select-Object -First 1")
[void]$S.Add("if($null -eq $someBlob){ Die ""NEG_NO_BLOB_FOUND"" }")
[void]$S.Add("$b = [System.IO.File]::ReadAllBytes($someBlob.FullName); if($b.Length -lt 1){ Die ""NEG_BLOB_EMPTY"" }; $b[0] = ($b[0] -bxor 255); [System.IO.File]::WriteAllBytes($someBlob.FullName,$b)")
[void]$S.Add("$failed = $false; try { & $PSExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $RepoRoot ""scripts\haai_verify_packet_optionA_v1.ps1"") -RepoRoot $RepoRoot -PacketDir $pkt2 | Out-Host } catch { $failed = $true }")
[void]$S.Add("if(-not $failed){ Die ""NEGATIVE_VECTOR_DID_NOT_FAIL"" }")
[void]$S.Add("Write-Output ""SELFTEST_OK""")
Write-Utf8NoBomLf $SelfPath (($S.ToArray()) -join "`n")
Parse-GateFile $SelfPath

# Final parse-gate product scripts
$All = Get-ChildItem -LiteralPath $ScriptsDir -File -Filter "*.ps1" | Sort-Object FullName
foreach($f in $All){ Parse-GateFile $f.FullName }
Write-Output ("HAAI_BOOTSTRAP_OK: " + $RepoRoot)
Write-Output ("NEXT: powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + (Join-Path $RepoRoot "scripts\haai_selftest_v1.ps1") + " -RepoRoot " + $RepoRoot)
