# Sets up HAL's voice on this machine: the Kokoro model (multi-lang v1.0, about 350 MB) and a
# small Python environment with sherpa-onnx. Everything goes to %LOCALAPPDATA%\hal, nothing
# into the repository. Needs Python 3.10 or newer. Safe to run again: it skips what is there.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-voice.ps1
$ErrorActionPreference = 'Stop'

$hal = Join-Path $env:LOCALAPPDATA 'hal'
$models = Join-Path $hal 'models\kokoro'
$model = Join-Path $models 'kokoro-multi-lang-v1_0\model.onnx'
$venv = Join-Path $hal 'venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2'

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

New-Item -ItemType Directory -Force -Path $models | Out-Null

if (Test-Path -LiteralPath $model) {
  Write-Host 'Kokoro model: already there.'
} else {
  $archive = Join-Path $hal 'kokoro-multi-lang-v1_0.tar.bz2'
  Write-Host 'Kokoro model: downloading about 350 MB from the sherpa-onnx releases on GitHub...'
  & curl.exe -sSL --fail -o $archive $url
  if ($LASTEXITCODE -ne 0) { throw 'The download failed.' }
  Write-Host 'Kokoro model: unpacking...'
  & tar.exe -xjf $archive -C $models
  if ($LASTEXITCODE -ne 0) { throw 'Unpacking failed.' }
  Remove-Item -LiteralPath $archive -Force
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

Write-Host 'Python environment: installing sherpa-onnx and numpy...'
& $venvPython -m pip install --quiet --disable-pip-version-check 'sherpa-onnx==2.0.1' numpy
if ($LASTEXITCODE -ne 0) { throw 'Installing sherpa-onnx failed.' }
& $venvPython -I -c 'import sherpa_onnx; print("sherpa-onnx", sherpa_onnx.__version__)'

Write-Host ''
Write-Host 'Done. Restart Claude Code and type /hal check: it should say "kokoro ready".'
