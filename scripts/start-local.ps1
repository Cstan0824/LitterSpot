[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $root ".venv\Scripts\python.exe"
$pidFile = Join-Path $root ".local\local-services.json"
$classifier = if ($env:STATE_CLASSIFIER_PATH) { $env:STATE_CLASSIFIER_PATH } else { Join-Path $root "runs\state_classifier\multitask_gco_gbs_v2\production.pt" }

if (!(Test-Path $python)) { throw "Python environment missing. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt" }
if (!(Test-Path $classifier)) { Write-Warning "No bin-state classifier was found. The dashboard will run, but FastAPI will report degraded until STATE_CLASSIFIER_PATH points to a local checkpoint." }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (!$npm -and !$bun) { throw "Node.js (which includes npm) or Bun is required. Install Node.js LTS, then run: npm install" }

if (Test-Path $pidFile) {
  & (Join-Path $PSScriptRoot "stop-local.ps1")
}
$occupied = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(8000, 3000, 5173) } | Select-Object -ExpandProperty LocalPort -Unique
if ($occupied) { throw "LitterSpot ports already in use: $($occupied -join ', '). Close the existing services, then run npm start again." }
New-Item -ItemType Directory -Force -Path (Split-Path $pidFile) | Out-Null

function Start-ServiceProcess([string]$Name, [string]$FilePath, [string[]]$Arguments, [hashtable]$Environment) {
  $previous = @{}
  foreach ($key in $Environment.Keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, "Process"); [Environment]::SetEnvironmentVariable($key, $Environment[$key], "Process") }
  try {
    return Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $root -NoNewWindow -PassThru
  } finally {
    foreach ($key in $Environment.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], "Process") }
  }
}

$token = "local-playground-token"
$runner = if ($npm) { $npm.Source } else { $bun.Source }
$backendArguments = if ($npm) { @("--workspace=backend", "run", "dev") } else { @("run", "dev:backend") }
$frontendArguments = if ($npm) { @("--workspace=frontend", "run", "dev", "--", "--host", "127.0.0.1") } else { @("run", "dev:frontend", "--", "--host", "127.0.0.1") }
$pythonProcess = Start-ServiceProcess "fastapi" $python @("-m", "uvicorn", "app.main:app", "--app-dir", "ai-service", "--host", "127.0.0.1", "--port", "8000") @{ STATE_CLASSIFIER_PATH = $classifier; STATE_CLASSIFIER_VERSION = "multitask-mobilenet-gco-gbs-v2"; DEVICE = "0"; INTERNAL_API_TOKEN = $token }
$nodeProcess = Start-ServiceProcess "node" $runner $backendArguments @{ AI_SERVICE_URL = "http://127.0.0.1:8000"; AI_SERVICE_TOKEN = $token }
$reactProcess = Start-ServiceProcess "react" $runner $frontendArguments @{}

@{ fastapi = $pythonProcess.Id; node = $nodeProcess.Id; react = $reactProcess.Id } | ConvertTo-Json | Set-Content -Encoding utf8 $pidFile

$dashboard = "http://127.0.0.1:5173/"
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $dashboard -TimeoutSec 2 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Seconds 1 }
  }
  if (!$ready) { throw "The dashboard did not start within 30 seconds." }
  Start-Process $dashboard
  Write-Host "LitterSpot is running in this terminal: $dashboard" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop all services. Logs are visible above."
  while ($true) {
    $finished = @($pythonProcess, $nodeProcess, $reactProcess) | Where-Object HasExited
    if ($finished) { throw "A service stopped unexpectedly (PID $($finished[0].Id))." }
    Start-Sleep -Seconds 1
  }
} finally {
  if (Test-Path $pidFile) { & (Join-Path $PSScriptRoot "stop-local.ps1") }
}
