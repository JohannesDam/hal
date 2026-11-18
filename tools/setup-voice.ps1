# Sets up HAL's voice and ears on this machine: the Piper voice kestrin (about 61 MB, from this
# repository's GitHub release), the speech models he listens with (Silero VAD and multilingual
# Whisper small, about 375 MB), and a small Python environment with piper-tts, sherpa-onnx and
# soundcard. Everything goes to %LOCALAPPDATA%\hal, nothing into the repository. Needs Python
# 3.10 or newer. Safe to run again: it skips what is there and checks every file's SHA-256.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-voice.ps1 [-NoEars] [-NoSight] [-Kokoro]
#
# -NoEars leaves the speech models out: HAL speaks but cannot listen along.
# -NoSight leaves out OpenCV and the face model (YuNet, about 230 KB): /hal see then finds no eyes.
# -Kokoro also fetches the Kokoro model (about 350 MB): the earlier voice am_michael, used by
# tools\listening_test.py and as HAL's voice when kestrin is missing.
param([switch]$NoEars, [switch]$NoSight, [switch]$Kokoro)
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

# The ears: Silero VAD from the sherpa-onnx releases, Whisper small (int8) from the
# sherpa-onnx author's Hugging Face repository.
$earsFiles = @(
  @{ dir = 'vad'; name = 'silero_vad.onnx'; sha = '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'
     url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx' }
  @{ dir = 'whisper-small'; name = 'small-encoder.int8.onnx'; sha = '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9'
     url = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-encoder.int8.onnx' }
  @{ dir = 'whisper-small'; name = 'small-decoder.int8.onnx'; sha = 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee'
     url = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-decoder.int8.onnx' }
  @{ dir = 'whisper-small'; name = 'small-tokens.txt'; sha = 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126'
     url = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-tokens.txt' }
)

# The sight (/hal see): OpenCV's YuNet face detector from the opencv_zoo repository.
$sightFile = @{ dir = 'sight'; name = 'face_detection_yunet_2023mar.onnx'; sha = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
  url = 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' }

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

# One file: skipped when it is there and right; else downloaded beside it and checked first.
function Get-Checked([string]$label, [string]$dir, [string]$name, [string]$url, [string]$sha256) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $path = Join-Path $dir $name
  if (Test-Hash $path $sha256) { Write-Host "${label}: $name already there."; return }
  Write-Host "${label}: downloading $name..."
  $part = "$path.part"
  & curl.exe -sSL --fail -o $part $url
  if ($LASTEXITCODE -ne 0) { throw "The download of $name failed." }
  if (-not (Test-Hash $part $sha256)) { Remove-Item -LiteralPath $part -Force; throw "$name does not match its checksum." }
  Move-Item -LiteralPath $part -Destination $path -Force
}

foreach ($name in $piperFiles.Keys) {
  Get-Checked 'Voice kestrin' $piperDir $name "$release/$name" $piperFiles[$name]
}

if (-not $NoEars) {
  foreach ($f in $earsFiles) {
    Get-Checked 'Ears' (Join-Path $hal "models\$($f.dir)") $f.name $f.url $f.sha
  }
}

if (-not $NoSight) {
  Get-Checked 'Sight' (Join-Path $hal "models\$($sightFile.dir)") $sightFile.name $sightFile.url $sightFile.sha
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

# piper-tts speaks kestrin with its own espeak-ng; sherpa-onnx runs the VAD, Whisper and
# Kokoro; soundcard records the microphone and the loopback of the output (WASAPI).
Write-Host 'Python environment: installing piper-tts, sherpa-onnx, soundcard and numpy...'
& $venvPython -m pip install --quiet --disable-pip-version-check 'piper-tts==1.8.0' 'sherpa-onnx==2.0.1' 'soundcard==0.4.6' numpy
if ($LASTEXITCODE -ne 0) { throw 'Installing the Python packages failed.' }
if (-not $NoSight) {
  # OpenCV without its GUI parts: one webcam frame, measured and dropped (assets\hal-sight.py).
  # 4.12 wants numpy below 2.3; pip settles that, and piper-tts and sherpa-onnx accept it.
  Write-Host 'Python environment: installing opencv-python-headless for /hal see...'
  & $venvPython -m pip install --quiet --disable-pip-version-check 'opencv-python-headless==4.12.0.88'
  if ($LASTEXITCODE -ne 0) { throw 'Installing OpenCV failed.' }
}
# No double quotes in the code: Windows PowerShell drops them on the way to a native program.
& $venvPython -I -c 'import piper, sherpa_onnx, soundcard; print(''piper-tts and soundcard ready, sherpa-onnx'', sherpa_onnx.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'The Python packages do not load.' }

Write-Host ''
Write-Host 'Done. Restart Claude Code and type /hal check: it should say "neural voice ready" and "ears listening".'
