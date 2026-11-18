# Releases HAL in one go: checks, version, commit, tag, push, GitHub release, local update.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\release.ps1 -Version 0.6.0 [-Tag] [-Notes notes.md] [-NoUpdate]
#
# Commit your own changes first: the working tree must be clean apart from what this script
# writes (the version in .claude-plugin/plugin.json). Without -Tag it only bumps, commits and
# pushes. -Notes (with -Tag) publishes a GitHub release with that Markdown file as its text.
# -NoUpdate skips `claude plugin update` on this machine.
#
# Pushing reads the GitHub login that Git Credential Manager keeps for the remote's user and
# hands it to git for this one command only (it never reaches a file or the command line):
# inside some shells GCM's own lookup fails silently during a push.
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [switch]$Tag,
  [string]$Notes = '',
  [switch]$NoUpdate
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$python = Join-Path $env:LOCALAPPDATA 'hal\venv\Scripts\python.exe'

function Step([string]$text) { Write-Host "-- $text" }
function Fail([string]$text) { Write-Host "FAILED: $text" -ForegroundColor Red; exit 1 }

Step 'clean working tree'
$dirty = @(git status --porcelain | Where-Object { $_ -notmatch 'plugin\.json$' })
if ($dirty.Count -gt 0) { Fail "commit or stash these first:`n$($dirty -join "`n")" }
if (-not (git config user.email)) { Fail 'no commit identity: git config user.name / user.email' }

Step 'checks'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'assets\hal-host.ps1'), [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { Fail "hal-host.ps1 does not parse: $($errors[0].Message)" }
& claude plugin validate . | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'claude plugin validate' }
& claude plugin test .
if ($LASTEXITCODE -ne 0) { Fail 'claude plugin test' }
if (Test-Path -LiteralPath $python) {
  & $python -X utf8 -s -m unittest discover -s tests
  if ($LASTEXITCODE -ne 0) { Fail 'python tests' }
} else {
  Write-Host '   (no venv: the Python tests are skipped; run tools\setup-voice.ps1)'
}

Step "version $Version"
$manifest = Join-Path $root '.claude-plugin\plugin.json'
$text = [IO.File]::ReadAllText($manifest)
$text = [regex]::Replace($text, '"version":\s*"[^"]*"', "`"version`": `"$Version`"")
[IO.File]::WriteAllText($manifest, $text, (New-Object Text.UTF8Encoding($false)))
git add .claude-plugin/plugin.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "Version $Version" }
if ($Tag) {
  if (git tag --list "v$Version") { Fail "tag v$Version exists" }
  git tag -a "v$Version" -m "HAL $Version"
}

Step 'push'
$remote = git remote get-url origin
if ($remote -notmatch 'github\.com[/:]([^/]+)/([^/.]+)') { Fail "origin is not a GitHub repository: $remote" }
$owner = $Matches[1]; $repo = $Matches[2]
$user = if ($remote -match 'https://([^@/]+)@') { $Matches[1] } else { $owner }
$env:GCM_INTERACTIVE = 'never'
$answer = "protocol=https`nhost=github.com`nusername=$user`n`n" | git credential-manager get 2>$null
$token = ($answer | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { Fail "no GitHub login for $user in Git Credential Manager: run  git credential-manager github login" }
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$token"))
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
$env:GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic $basic"
$env:GIT_TERMINAL_PROMPT = '0'
try {
  git -c credential.helper= push origin HEAD
  if ($LASTEXITCODE -ne 0) { Fail 'git push' }
  if ($Tag) {
    git -c credential.helper= push origin "v$Version"
    if ($LASTEXITCODE -ne 0) { Fail 'git push of the tag' }
  }
} finally {
  Remove-Item Env:GIT_CONFIG_VALUE_0, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_COUNT -ErrorAction SilentlyContinue
}

if ($Tag -and $Notes) {
  Step 'GitHub release'
  $body = @{ tag_name = "v$Version"; name = "HAL $Version"; body = [IO.File]::ReadAllText((Resolve-Path $Notes), [Text.Encoding]::UTF8) } | ConvertTo-Json -Compress
  $headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'hal-release'; Accept = 'application/vnd.github+json' }
  try {
    $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$owner/$repo/releases" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8'
    Write-Host "   $($release.html_url)"
  } catch {
    Write-Host "   the release was not created: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
  }
}
$token = $null; $basic = $null

if (-not $NoUpdate) {
  Step 'update on this machine'
  & claude plugin marketplace update hal | Select-Object -Last 1
  & claude plugin update hal@hal | Select-Object -Last 1
}
Write-Host "Done: HAL $Version. Restart Claude Code to load it."
