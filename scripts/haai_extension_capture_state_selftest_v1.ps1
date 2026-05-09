Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = "C:\dev\haai"
$Manifest = Join-Path $RepoRoot "extension\manifest.json"
$Bg = Join-Path $RepoRoot "extension\src\background.js"
$Content = Join-Path $RepoRoot "extension\src\content_script.js"
$PopupHtml = Join-Path $RepoRoot "extension\src\popup.html"
$PopupJs = Join-Path $RepoRoot "extension\src\popup.js"

function Die {
  param([string]$Message)
  throw $Message
}

function ParseGateJs {
  param([Parameter(Mandatory=$true)][string]$Path)

  $node = Get-Command node -ErrorAction SilentlyContinue
  if(-not $node){
    Die "NODE_NOT_FOUND_FOR_JS_PARSE_GATE"
  }

  $code = @"
const fs = require("fs");
const path = process.argv[1];
const text = fs.readFileSync(path, "utf8");
new Function(text);
console.log("JS_PARSE_OK:" + path);
"@

  $tmp = Join-Path $env:TEMP ("haai_js_parse_gate_" + [Guid]::NewGuid().ToString("N") + ".cjs")
  [IO.File]::WriteAllText($tmp,$code,(New-Object System.Text.UTF8Encoding($false)))

  try {
    & $node.Source $tmp $Path
    if($LASTEXITCODE -ne 0){
      Die ("JS_PARSE_FAIL:" + $Path)
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

foreach($p in @($Manifest,$Bg,$Content,$PopupHtml,$PopupJs)){
  if(-not (Test-Path -LiteralPath $p -PathType Leaf)){
    Die ("HAAI_EXPECTED_FILE_MISSING:" + $p)
  }
}

[void](Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json)

ParseGateJs $Bg
ParseGateJs $Content
ParseGateJs $PopupJs

$bgText = Get-Content -LiteralPath $Bg -Raw
$contentText = Get-Content -LiteralPath $Content -Raw
$popupText = Get-Content -LiteralPath $PopupJs -Raw
$htmlText = Get-Content -LiteralPath $PopupHtml -Raw

foreach($marker in @(
  "HAAI_STATE_KEY",
  "haai_begin_capture",
  "haai_stop_capture",
  "haai_record_event",
  "haai_get_events",
  "detectAiSurface"
)){
  if($bgText -notmatch [regex]::Escape($marker)){
    Die ("HAAI_BACKGROUND_MARKER_MISSING:" + $marker)
  }
}

foreach($marker in @(
  "HAAI_CONTENT_MARK",
  "haai_capture_probe",
  "haai_build_context_prompt",
  "page_snapshot_changed",
  "input_surface_changed"
)){
  if($contentText -notmatch [regex]::Escape($marker)){
    Die ("HAAI_CONTENT_MARKER_MISSING:" + $marker)
  }
}

foreach($marker in @(
  "beginButton.disabled",
  "stopButton.disabled",
  "Probe Page",
  "haai_get_state",
  "haai_capture_probe"
)){
  if(($popupText + $htmlText) -notmatch [regex]::Escape($marker)){
    Die ("HAAI_POPUP_MARKER_MISSING:" + $marker)
  }
}

Write-Host "HAAI_CAPTURE_STATE_SELFTEST_OK" -ForegroundColor Green
