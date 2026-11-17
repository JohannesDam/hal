# Sets up HAL's voice on this machine: the Piper voice kestrin (about 61 MB, from this
# repository's GitHub release) and a small Python environment with piper-tts and sherpa-onnx.
# Everything goes to %LOCALAPPDATA%\hal, nothing into the repository. Needs Python 3.10 or newer.
# Safe to run again: it skips what is there.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-voice.ps1 [-Kokoro]
#
# -Kokoro also fetches the Kokoro model (about 350 MB): the earlier voice am_michael, used by
# tools\listening_test.py and as HAL's voice when kestrin is missing.
param([switch]$Kokoro)
$ErrorActionPreference = 'Stop'

$hal = Join-Path $env:LOCALAPPDATA 'hal'
$venv = Join-Path $hal 'venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'

$release = 'https://github.com/JohannesDam/hal/releases/download/voice-kestrin'
$piperDir = Join-Path $hal 'models\piper\kestrin'
$piperFiles = [ordered]@{
  'kestrin.onnx'      = 'ca67ab0520c4159832e3f9adb185eda4815e4bc11242c3a67b3286ec0de433f6'
  'kestrin.onnx.json' = '0f72f6afe3246c1e634bd6a7e0832739f847bb89ca22a5729bd5c15fd34ed1bb'
}

$kokoroDir = Join-Path $hal 'models\kokoro'
$kokoroModel = Join-Path $kokoroDir 'kokoro-multi-lang-v1_0\model.onnx'
$kokoroUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2'

function Find-Python {
  # The Python launcher first; never the Microsoft Store stub in WindowsApps.
  foreach ($candidate in @(@('py', '-3'), @('python'))) {
    $command = Get-Command $candidate[0] -ErrorAction SilentlyContinue
    if (-not $command -or $command.Source -like '*WindowsApps*') { continue }
    $args = @($candidate | Select-Object -Skip 1)
    $version = & $command.Source @args -c 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])' 2>$null
    if ([int]$version -ge 310) { return @{ path = $command.Source; args = $args } }
  }
  $null
}

function Test-Hash([string]$path, [string]$sha256) {
  (Test-Path -LiteralPath $path) -and ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $sha256)
}

# The voice kestrin, checked file by file.
New-Item -ItemType Directory -Force -Path $piperDir | Out-Null
foreach ($name in $piperFiles.Keys) {
  $path = Join-Path $piperDir $name
  if (Test-Hash $path $piperFiles[$name]) { Write-Host "Voice kestrin: $name already there."; continue }
  Write-Host "Voice kestrin: downloading $name from GitHub..."
  $part = "$path.part"
  & curl.exe -sSL --fail -o $part "$release/$name"
  if ($LASTEXITCODE -ne 0) { throw "The download of $name failed." }
  if (-not (Test-Hash $part $piperFiles[$name])) { Remove-Item -LiteralPath $part -Force; throw "$name does not match its checksum." }
  Move-Item -LiteralPath $part -Destination $path -Force
}

if ($Kokoro) {
  New-Item -ItemType Directory -Force -Path $kokoroDir | Out-Null
  if (Test-Path -LiteralPath $kokoroModel) {
    Write-Host 'Kokoro model: already there.'
  } else {
    $archive = Join-Path $hal 'kokoro-multi-lang-v1_0.tar.bz2'
    Write-Host 'Kokoro model: downloading about 350 MB from the sherpa-onnx releases on GitHub...'
    & curl.exe -sSL --fail -o $archive $kokoroUrl
    if ($LASTEXITCODE -ne 0) { throw 'The download failed.' }
    Write-Host 'Kokoro model: unpacking...'
    & tar.exe -xjf $archive -C $kokoroDir
    if ($LASTEXITCODE -ne 0) { throw 'Unpacking failed.' }
    Remove-Item -LiteralPath $archive -Force
  }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  $python = Find-Python
  if (-not $python) {
    throw 'Python 3.10 or newer was not found. Install it first, for example: winget install Python.Python.3.12'
  }
  Write-Host 'Python environment: creating...'
  & $python.path @($python.args) -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw 'Creating the Python environment failed.' }
}

# piper-tts speaks kestrin with its own espeak-ng; sherpa-onnx runs Kokoro and, later, listening.
Write-Host 'Python environment: installing piper-tts, sherpa-onnx and numpy...'
& $venvPython -m pip install --quiet --disable-pip-version-check 'piper-tts==1.8.0' 'sherpa-onnx==2.0.1' numpy
if ($LASTEXITCODE -ne 0) { throw 'Installing the Python packages failed.' }
# No double quotes in the code: Windows PowerShell drops them on the way to a native program.
& $venvPython -I -c 'import piper, sherpa_onnx; print(''piper-tts ready, sherpa-onnx'', sherpa_onnx.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'The Python packages do not load.' }

Write-Host ''
Write-Host 'Done. Restart Claude Code and type /hal check: it should say "neural voice ready".'
