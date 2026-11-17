# HAL's last word (decision 4). Started by HAL's process through WMI, outside Claude Code's
# process tree, once a session has lasted twenty minutes. It waits for Claude Code to end,
# then plays the farewell rendered ahead (hal-host.ps1 rewrites it as the session goes on)
# and stops hard after 6 s. Nothing else: no window, no haze, no input.
#
#   hal-farewell.ps1 -Wav <path> -WatchPid <Claude Code's pid>
param(
  [Parameter(Mandatory = $true)][string]$Wav,
  [Parameter(Mandatory = $true)][int]$WatchPid,
  [double]$MaxSeconds = 6
)
$ErrorActionPreference = 'Stop'

# One waiter per Claude Code.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\HAL-farewell-$WatchPid", [ref]$created)
if (-not $created) { exit 0 }

try {
  try { $claude = Get-Process -Id $WatchPid } catch { exit 0 }
  $claude.WaitForExit()

  # /hal off, or a session that never earned one, leaves no file behind: then silence.
  if (-not (Test-Path -LiteralPath $Wav)) { exit 0 }
  $bytes = [IO.File]::ReadAllBytes($Wav)
  Remove-Item -LiteralPath $Wav -Force -ErrorAction SilentlyContinue
  if ($bytes.Length -lt 48) { exit 0 }

  # The length from the header: 16-bit PCM, its rate and channels.
  $channels = [BitConverter]::ToInt16($bytes, 22)
  $rate = [BitConverter]::ToInt32($bytes, 24)
  $seconds = ($bytes.Length - 44) / [double]([Math]::Max(1, $rate * $channels * 2))
  $player = New-Object System.Media.SoundPlayer (New-Object System.IO.MemoryStream (, $bytes))
  $player.Load()
  $player.Play()
  Start-Sleep -Milliseconds ([int](1000 * [Math]::Min($MaxSeconds, $seconds + 0.2)))
  $player.Stop()
} finally {
  $mutex.ReleaseMutex()
}
