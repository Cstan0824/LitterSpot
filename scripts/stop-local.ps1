[CmdletBinding()]
param()

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidFile = Join-Path $root ".local\local-services.json"
if (!(Test-Path $pidFile)) { Write-Host "No local LitterSpot services are recorded as running."; exit 0 }

try {
  $services = Get-Content $pidFile -Raw | ConvertFrom-Json
  function Stop-ProcessTree([int]$ProcessId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) { Stop-ProcessTree ([int]$child.ProcessId) }
    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
  }
  foreach ($entry in $services.PSObject.Properties) {
    $process = Get-Process -Id $entry.Value -ErrorAction SilentlyContinue
    if ($process) { Stop-ProcessTree ([int]$entry.Value); Write-Host "Stopped $($entry.Name) and child processes (PID $($entry.Value))." }
  }
} finally {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
