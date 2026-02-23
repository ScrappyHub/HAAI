param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [Parameter(Mandatory=$true)][string]$InputJson
)



Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $RepoRoot "scripts\_lib_haai_core_v1.ps1")

if(-not (Test-Path -LiteralPath $InputJson -PathType Leaf)){ Die ("MISSING_INPUT_JSON: " + $InputJson) }
EnsureDir $OutDir

$raw = Get-Content -LiteralPath $InputJson -Raw
$obj = $raw | ConvertFrom-Json

$producer = $obj.producer
if($null -eq $producer){ Die "CAPTURE_MISSING_PRODUCER" }

$enc = New-Object System.Text.UTF8Encoding($false)

# messages blob
$messagesJson  = To-CanonJson $obj.messages
$messagesBytes = $enc.GetBytes($messagesJson)
$messagesSha   = Sha256HexBytes $messagesBytes
$messagesPath  = Join-Path $OutDir ("payload\blobs\{0}\content" -f $messagesSha)
EnsureDir (Split-Path -Parent $messagesPath)
[System.IO.File]::WriteAllBytes($messagesPath, $messagesBytes)

# assistant blob
$assistantText  = [string]$obj.assistant_text
$assistantBytes = $enc.GetBytes($assistantText)
$assistantSha   = Sha256HexBytes $assistantBytes
$assistantPath  = Join-Path $OutDir ("payload\blobs\{0}\content" -f $assistantSha)
EnsureDir (Split-Path -Parent $assistantPath)
[System.IO.File]::WriteAllBytes($assistantPath, $assistantBytes)

$strength = "evidence"
if($obj.strength){ $strength = [string]$obj.strength }

$run = @{
  schema      = "haai.run_envelope.v1"
  created_utc = (NowUtc)
  producer    = @{
    name        = [string]$producer.name
    version     = [string]$producer.version
    instance_id = [string]$producer.instance_id
  }
  strength = $strength
  model    = $obj.model
  inputs   = @{ messages_ref = ("sha256:" + $messagesSha) }
  outputs  = @{ assistant_message_ref = ("sha256:" + $assistantSha) }
  links    = @{ prev_run_refs = @() }
}

$runJson  = To-CanonJson $run
$runPath  = Join-Path $OutDir "payload\run_envelope.json"
Write-Utf8NoBomLf $runPath $runJson

$runHash = Sha256HexBytes ($enc.GetBytes($runJson))
Append-Receipt -RepoRoot $RepoRoot -Row @{
  event  = "haai.capture.v1"
  result = "ok"
  details = @{
    out_dir             = $OutDir
    run_envelope_sha256 = $runHash
    messages_sha256     = $messagesSha
    assistant_sha256    = $assistantSha
  }
}

Write-Output ("OK: CAPTURED: out=" + $OutDir)
