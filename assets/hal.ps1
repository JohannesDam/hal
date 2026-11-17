# One line from HAL, for testing from a shell:
#   powershell -NoProfile -STA -ExecutionPolicy Bypass -File hal.ps1 -Text "Three files changed." [-Haze 0]
# When HAL's process is already running, the line goes to its inbox; otherwise it is spoken here and this exits.
param(
  [string]$Text = "",
  [string]$Text64 = "",
  [int]$Haze = 1,
  [double]$Strength = 0.56
)
if ($Text64) { $Text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Text64)) }
if (-not $Text) { exit 0 }
& (Join-Path $PSScriptRoot 'hal-host.ps1') -Say $Text -Haze $Haze -Strength $Strength
