Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Die([string]$m){ throw $m }

function EnsureDir([string]$Path){
  if([string]::IsNullOrWhiteSpace($Path)){ Die "EnsureDir: empty" }
  if(-not (Test-Path -LiteralPath $Path -PathType Container)){
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Write-Utf8NoBomLf([string]$Path,[string]$Text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $t = ($Text -replace "`r`n","`n") -replace "`r","`n"
  if(-not $t.EndsWith("`n")){ $t += "`n" }
  $dir = Split-Path -Parent $Path
  if($dir){ EnsureDir $dir }
  [System.IO.File]::WriteAllText($Path,$t,$enc)
}

function Sha256HexBytes([byte[]]$Bytes){
  if($null -eq $Bytes){ Die "SHA256_NULL_BYTES" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $h = $sha.ComputeHash($Bytes) } finally { $sha.Dispose() }
  $sb = New-Object System.Text.StringBuilder
  foreach($b in $h){ [void]$sb.Append($b.ToString("x2")) }
  $sb.ToString()
}

function Sha256HexFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){ Die ("MISSING_FILE: " + $Path) }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  Sha256HexBytes $bytes
}

function Escape-JsonString([string]$s){
  if($null -eq $s){ return "" }
  $sb = New-Object System.Text.StringBuilder
  foreach($ch in $s.ToCharArray()){
    $c = [int][char]$ch
    if($c -eq 34){ [void]$sb.Append('\"') }
    elseif($c -eq 92){ [void]$sb.Append('\\') }
    elseif($c -eq 8){ [void]$sb.Append('\b') }
    elseif($c -eq 12){ [void]$sb.Append('\f') }
    elseif($c -eq 10){ [void]$sb.Append('\n') }
    elseif($c -eq 13){ [void]$sb.Append('\r') }
    elseif($c -eq 9){ [void]$sb.Append('\t') }
    elseif($c -lt 32){ [void]$sb.Append(("\\u{0:x4}" -f $c)) }
    else { [void]$sb.Append([char]$c) }
  }
  $sb.ToString()
}

function To-CanonJson([object]$v){
  if($null -eq $v){ return "null" }

  if($v -is [bool]){
    if($v){ return "true" } else { return "false" }
  }

  if($v -is [string]){
    return ('"' + (Escape-JsonString $v) + '"')
  }

  if($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]){
    return ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $v))
  }

  if($v -is [System.Collections.IDictionary]){
    $keys = @($v.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    $parts = New-Object System.Collections.Generic.List[string]
    foreach($k in $keys){
      $val = $v[$k]
      [void]$parts.Add(('"' + (Escape-JsonString $k) + '":' + (To-CanonJson $val)))
    }
    return ('{' + (($parts.ToArray()) -join ',') + '}')
  }

  if($v -is [System.Collections.IEnumerable] -and -not ($v -is [string])){
    $parts = New-Object System.Collections.Generic.List[string]
    foreach($it in $v){ [void]$parts.Add((To-CanonJson $it)) }
    return ('[' + (($parts.ToArray()) -join ',') + ']')
  }

  $props = @{}
  foreach($p in $v.PSObject.Properties){
    if($p.MemberType -eq "NoteProperty" -or $p.MemberType -eq "Property"){
      $props[$p.Name] = $p.Value
    }
  }
  return (To-CanonJson $props)
}

function NowUtc(){
  [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

function Append-Receipt([string]$RepoRoot,[hashtable]$Row){
  $p = Join-Path $RepoRoot "proofs\receipts\haai.ndjson"
  $Row["schema"] = "haai.receipt.v1"
  if(-not $Row.ContainsKey("time_utc")){ $Row["time_utc"] = (NowUtc) }
  $line = (To-CanonJson $Row)
  $enc = New-Object System.Text.UTF8Encoding($false)
  $dir = Split-Path -Parent $p
  if($dir){ EnsureDir $dir }
  if(-not (Test-Path -LiteralPath $p -PathType Leaf)){
    [System.IO.File]::WriteAllText($p, ($line + "`n"), $enc)
  } else {
    [System.IO.File]::AppendAllText($p, ($line + "`n"), $enc)
  }
}
