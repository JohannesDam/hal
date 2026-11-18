# Renders the pictures in docs/images from the mod's own drawing code; nothing of the real
# screen is captured. The terminal: hooks/eye.ts through tools/render-terminal.mjs (Node 22.6
# or newer) and Microsoft Edge headless. The haze: the host's own XAML and drawing functions,
# lifted out of assets/hal-host.ps1 and rendered offscreen over a plain desktop.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\render-pictures.ps1
param([string]$Out = (Join-Path $PSScriptRoot '..\docs\images'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing

$Out = [System.IO.Path]::GetFullPath($Out)
$work = Join-Path $env:TEMP 'hal-pictures'
New-Item -ItemType Directory -Force $Out, $work | Out-Null

# ---------- the terminal ----------
node (Join-Path $PSScriptRoot 'render-terminal.mjs') $work | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'render-terminal.mjs failed' }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found' }
$sizes = Get-Content (Join-Path $work 'sizes.json') -Raw | ConvertFrom-Json
foreach ($name in 'terminal', 'terminal-speaking') {
  $size = $sizes.$name
  $png = Join-Path $work "$name.png"
  Remove-Item $png -ErrorAction SilentlyContinue
  $url = 'file:///' + ((Join-Path $work "$name.html") -replace '\\', '/')
  # Piping makes PowerShell wait for Edge, a windowed program; Edge reports on stderr.
  $ErrorActionPreference = 'Continue'
  & $edge --headless=new --disable-gpu --hide-scrollbars --no-first-run "--user-data-dir=$work\edge" --force-device-scale-factor=2 "--window-size=$($size.width),$($size.height)" "--screenshot=$png" $url 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
  if (-not (Test-Path $png)) { throw "Edge wrote no $name.png" }
}
Copy-Item (Join-Path $work 'terminal.png') (Join-Path $Out 'terminal.png') -Force

# ---------- the haze, with the host's own parts ----------
$hostPath = Join-Path $PSScriptRoot '..\assets\hal-host.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($hostPath, [ref]$null, [ref]$null)
$xamlAssign = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$eyeXaml' }, $true)
. ([scriptblock]::Create($xamlAssign.Extent.Text))
foreach ($name in 'New-HazeWindow', 'Set-Diaphragm', 'Set-Layout', 'Set-Strength', 'ToByte', 'Set-Haze') {
  $f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  . ([scriptblock]::Create($f.Extent.Text))
}
function Emit($obj) { Write-Host ($obj | ConvertTo-Json -Compress) }
$script:systemScale = 1.0
$W = 1920; $H = 1080

function New-Desktop([string]$terminalPng) {
  $root = New-Object System.Windows.Controls.Grid
  $root.Width = $W; $root.Height = $H
  $wall = New-Object System.Windows.Shapes.Rectangle
  $wall.Fill = New-Object System.Windows.Media.LinearGradientBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#FF2B3036')), ([System.Windows.Media.ColorConverter]::ConvertFromString('#FF14171B')), 60.0
  [void]$root.Children.Add($wall)
  if (-not $terminalPng) { return $root }
  $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
  $bmp.BeginInit(); $bmp.CacheOption = 'OnLoad'; $bmp.UriSource = New-Object System.Uri $terminalPng; $bmp.EndInit()
  $size = $sizes.'terminal-speaking'
  $img = New-Object System.Windows.Controls.Image
  $img.Source = $bmp; $img.Width = $size.width; $img.Height = $size.height; $img.Stretch = 'Fill'
  $img.HorizontalAlignment = 'Left'; $img.VerticalAlignment = 'Top'
  $img.Margin = New-Object System.Windows.Thickness ([Math]::Round(($W - $size.width) / 2.0)), 190.0, 0.0, 0.0
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($img, 'HighQuality')
  $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
  $shadow.BlurRadius = 30; $shadow.ShadowDepth = 6; $shadow.Opacity = 0.6; $shadow.Color = [System.Windows.Media.Colors]::Black
  $img.Effect = $shadow
  [void]$root.Children.Add($img)
  $root
}

# One frame of the haze, set the way the host's loop sets it.
function New-Haze($state) {
  $screen = [pscustomobject]@{ Bounds = New-Object System.Drawing.Rectangle 0, 0, $W, $H }
  $p = New-HazeWindow $screen
  $grid = $p.win.Content; $p.win.Content = $null
  $p.win = [pscustomobject]@{ ActualWidth = [double]$W; ActualHeight = [double]$H }
  Set-Layout $p
  Set-Strength $p 0.56   # mood level 2: 0.4 + 0.08 * 2
  Set-Haze $p 1.0 1.0
  $p.EyeGroup.Opacity = 1.0
  $p.EyeScale.ScaleX = $p.baseScale; $p.EyeScale.ScaleY = $p.baseScale
  $p.Spark.Opacity = 0.0
  $p.Line.Text = $state.text; $p.Line.Opacity = $state.line
  $p.Bloom.Opacity = 0.34; $p.Iris.Opacity = 0.88
  Set-Diaphragm $p $state.open $state.gx $state.gy $state.rot
  $p.rim.Opacity = $state.rim
  $p.Spin.Angle = $state.spin
  $grid
}

function Render($desktop, $haze, [double]$scale) {
  $root = New-Object System.Windows.Controls.Grid
  $root.Width = $W; $root.Height = $H
  [void]$root.Children.Add($desktop)
  [void]$root.Children.Add($haze)
  $root.Measure((New-Object System.Windows.Size $W, $H)); $root.Arrange((New-Object System.Windows.Rect 0, 0, $W, $H)); $root.UpdateLayout()
  $rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap ([int]($W * $scale)), ([int]($H * $scale)), (96 * $scale), (96 * $scale), ([System.Windows.Media.PixelFormats]::Pbgra32)
  $rtb.Render($root)
  $rtb
}

function Save($bitmap, [string]$path) {
  $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $fs = [System.IO.File]::Create($path); $enc.Save($fs); $fs.Close()
}

# Speaking: he looks past you (upper left), the aperture held, the rim following the voice.
$speaking = @{ text = 'It was red for most of the evening.'; line = 0.85; open = 0.4; gx = -0.42; gy = -0.42; rot = 0.25; rim = 0.82; spin = 15.0 }
# Staring after the last word: straight at you, narrower.
$staring = @{ text = ''; line = 0.0; open = 0.35; gx = 0.0; gy = 0.0; rot = 0.33; rim = 0.65; spin = 21.0 }

# The whole screen while he speaks; the chat still hides his line behind dots.
Save (Render (New-Desktop (Join-Path $work 'terminal-speaking.png')) (New-Haze $speaking) 1.0) (Join-Path $Out 'overlay.png')

# Close-ups at twice the resolution, side by side: speaking, then staring.
$cx = $W / 2; $cy = $H / 2 - 0.04 * $H; $half = 215
$side = [int](4 * $half)
$pair = New-Object System.Windows.Controls.StackPanel
$pair.Orientation = 'Horizontal'
foreach ($state in $speaking, $staring) {
  $quiet = $state.Clone(); $quiet.line = 0.0
  $big = Render (New-Desktop '') (New-Haze $quiet) 2.0
  $rect = New-Object System.Windows.Int32Rect ([int](2 * ($cx - $half))), ([int](2 * ($cy - $half))), $side, $side
  $img = New-Object System.Windows.Controls.Image
  $img.Source = New-Object System.Windows.Media.Imaging.CroppedBitmap $big, $rect
  $img.Width = $side / 2; $img.Height = $side / 2
  [void]$pair.Children.Add($img)
}
$pair.Measure((New-Object System.Windows.Size $side, ($side / 2))); $pair.Arrange((New-Object System.Windows.Rect 0, 0, $side, ($side / 2))); $pair.UpdateLayout()
$rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap ($side * 2), $side, 192, 192, ([System.Windows.Media.PixelFormats]::Pbgra32)
$rtb.Render($pair)
Save $rtb (Join-Path $Out 'eye.png')

Get-ChildItem $Out -Filter *.png | ForEach-Object { '{0,-14} {1,8:N0} bytes' -f $_.Name, $_.Length }
