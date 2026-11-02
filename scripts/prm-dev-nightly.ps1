<#
.SYNOPSIS
  Runs PRM-dev with automatic nightly updates: pull the tracked branch, then restart the app.

.DESCRIPTION
  Meant for a dedicated clone (e.g. C:\Repos\PRM-dev) with its own .env, its own PORT and its
  own dev database: the app's boot-time `db:push --force` follows whatever branch is checked out.
  State and logs live in .prm-dev\ next to the repo root. See nightly-dev-updates-plan.md.

.EXAMPLE
  .\scripts\prm-dev-nightly.ps1 -Install -Branch Version-3   # set up, start, schedule nightly
  .\scripts\prm-dev-nightly.ps1 -Update                      # run tonight's update now
  .\scripts\prm-dev-nightly.ps1 -Uninstall                   # remove the tasks, stop PRM-dev
#>
[CmdletBinding()]
param(
  [string]$Branch,
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$Time,
  [switch]$Install,
  [switch]$Update,
  [switch]$Uninstall,
  [switch]$Start,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$StateDir = Join-Path $Root '.prm-dev'
$LogDir = Join-Path $StateDir 'logs'
$ConfigFile = Join-Path $StateDir 'config.json'
$PidFile = Join-Path $StateDir 'prm.pid'
$LockFile = Join-Path $StateDir 'update.lock'
$EnvFile = Join-Path $Root '.env'
# Named after the clone folder so two clones on one machine don't overwrite each other's tasks.
$TaskBase = "PRM-dev ($(Split-Path $Root -Leaf))"
$UpdateTask = "$TaskBase nightly update"
$LogonTask = "$TaskBase start at logon"

New-Item -ItemType Directory -Force $LogDir | Out-Null
$UpdateLog = Join-Path $LogDir "update-$(Get-Date -Format yyyy-MM-dd).log"

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Write-Host $line
  Add-Content -Path $UpdateLog -Value $line -Encoding UTF8
}

# Runs a command line through cmd so native stderr goes to the log instead of becoming
# PowerShell errors (Windows PowerShell 5.1 turns redirected stderr into ErrorRecords).
function Invoke-Logged([string]$CommandLine) {
  Write-Log "> $CommandLine"
  & cmd.exe /c "cd /d `"$Root`" && $CommandLine >> `"$UpdateLog`" 2>&1"
  return $LASTEXITCODE
}

function Get-GitOutput([string[]]$GitArgs) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & git -C $Root @GitArgs 2>$null } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out -join "`n").Trim()
}

function Get-EnvValue([string]$Name) {
  if (-not (Test-Path $EnvFile)) { return $null }
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match "^\s*$Name\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"', "'") }
  }
  return $null
}

function Get-Port {
  $port = Get-EnvValue 'PORT'
  if ($port) { return [int]$port }
  return 5000
}

function Get-Config {
  if (Test-Path $ConfigFile) { return Get-Content $ConfigFile -Raw | ConvertFrom-Json }
  return $null
}

function Get-PrmProcess {
  if (-not (Test-Path $PidFile)) { return $null }
  $id = [int](Get-Content $PidFile -Raw)
  return Get-Process -Id $id -ErrorAction SilentlyContinue
}

function Get-PortOwner([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
}

function Stop-Prm {
  $proc = Get-PrmProcess
  if ($proc) {
    Write-Log "Stopping PRM-dev (pid $($proc.Id))"
    # npm -> tsx -> node is a tree; killing only the top leaves node holding the port.
    & cmd.exe /c "taskkill /T /F /PID $($proc.Id) >nul 2>&1"
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue

  # Fallback for a stale pid file: whatever still listens on our port, if it runs from this repo.
  $port = Get-Port
  $owner = Get-PortOwner $port
  if ($owner -and $owner.CommandLine -like "*$Root\*") {
    Write-Log "Stopping leftover process on port $port (pid $($owner.ProcessId))"
    & cmd.exe /c "taskkill /T /F /PID $($owner.ProcessId) >nul 2>&1"
  }
  for ($i = 0; $i -lt 15 -and (Get-PortOwner $port); $i++) { Start-Sleep -Seconds 1 }
}

function Start-Whisper {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Log 'WARN docker not found; skipping Whisper (dictation will not work)'
    return
  }
  # The compose file pins container_name prm-whisper, so a second clone can't create its own;
  # reuse the one that exists.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $existing = & docker ps -a --filter 'name=^prm-whisper$' --format '{{.Names}}' 2>$null } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) {
    Write-Log 'WARN docker is not running; skipping Whisper (dictation will not work)'
    return
  }
  $code = if ($existing) { Invoke-Logged 'docker start prm-whisper' } else { Invoke-Logged 'docker compose -f docker-compose.whisper.yml up -d' }
  if ($code -ne 0) { Write-Log "WARN Whisper failed to start (exit $code)" }
}

function Start-Prm {
  if (Get-PrmProcess) {
    Write-Log "PRM-dev already running (pid $((Get-PrmProcess).Id))"
    return $true
  }
  $port = Get-Port
  $owner = Get-PortOwner $port
  if ($owner) {
    Write-Log "FAILED port $port is in use by pid $($owner.ProcessId) ($($owner.Name)), not this PRM-dev"
    return $false
  }

  Start-Whisper
  $appLog = Join-Path $LogDir "app-$(Get-Date -Format yyyy-MM-dd).log"
  Add-Content -Path $appLog -Value "`r`n===== start $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====" -Encoding UTF8
  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev >> `"$appLog`" 2>&1" `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII
  Write-Log "Started PRM-dev (pid $($proc.Id)), app log: $appLog"

  # Boot runs the schema push before listening, so give it a few minutes.
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5 | Out-Null
      Write-Log "OK PRM-dev is answering on http://localhost:$port"
      return $true
    } catch {
      # Any HTTP response, even an error status, means the server is up.
      if ($_.Exception.Response) {
        Write-Log "OK PRM-dev is answering on http://localhost:$port"
        return $true
      }
    }
    Start-Sleep -Seconds 3
  }

  $why = if ($proc.HasExited) { 'the app exited' } else { 'no answer after 3 minutes' }
  Write-Log "FAILED $why. Last lines of $appLog`:"
  Get-Content $appLog -Tail 50 | ForEach-Object { Write-Log "  | $_" }
  return $false
}

function Update-Repo([string]$TrackBranch) {
  $old = Get-GitOutput @('rev-parse', '--short', 'HEAD')
  $dirty = Get-GitOutput @('status', '--porcelain', '--untracked-files=no')
  if ($dirty) {
    # Never reset or stash to make a pull work: the tester's edits matter more than tonight's update.
    Write-Log "WARN working tree has local changes; skipped pull, staying on $old"
    return
  }

  if ((Invoke-Logged "git fetch origin $TrackBranch") -ne 0) {
    Write-Log "WARN git fetch failed; staying on $old"
    return
  }
  $current = Get-GitOutput @('rev-parse', '--abbrev-ref', 'HEAD')
  if ($current -ne $TrackBranch -and (Invoke-Logged "git switch $TrackBranch") -ne 0) {
    Write-Log "WARN could not switch to $TrackBranch; staying on $current@$old"
    return
  }
  if ((Invoke-Logged "git merge --ff-only origin/$TrackBranch") -ne 0) {
    Write-Log "WARN $TrackBranch can't fast-forward to origin/$TrackBranch (force-pushed or local commits); staying on $old"
  }

  $new = Get-GitOutput @('rev-parse', '--short', 'HEAD')
  Write-Log "Branch $TrackBranch : $old -> $new"

  & git -C $Root diff --quiet $old $new -- package-lock.json
  $lockChanged = $LASTEXITCODE -ne 0
  if ($lockChanged -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
    if ((Invoke-Logged 'npm install') -ne 0) { Write-Log 'WARN npm install failed; starting anyway' }
  } else {
    Write-Log 'package-lock.json unchanged; skipped npm install'
  }
}

function Invoke-Update {
  $config = Get-Config
  if (-not $config) { throw "No $ConfigFile; run with -Install first." }

  # A previous run still going (or one that died within the hour) means skip this one.
  if (Test-Path $LockFile) {
    if ((Get-Item $LockFile).LastWriteTime -gt (Get-Date).AddHours(-1)) {
      Write-Log 'Another update is running; skipped'
      return $true
    }
    Remove-Item $LockFile
  }
  Set-Content -Path $LockFile -Value $PID -Encoding ASCII
  try {
    Write-Log "===== nightly update ($($config.branch)) ====="
    Update-Repo $config.branch
    Stop-Prm
    $ok = Start-Prm
    Get-ChildItem $LogDir -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item
    return $ok
  } finally {
    Remove-Item $LockFile -ErrorAction SilentlyContinue
  }
}

function Register-Tasks([string]$At) {
  $ps = (Get-Command powershell.exe).Source
  $base = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

  Register-ScheduledTask -TaskName $UpdateTask -Force -Principal $principal -Settings $settings `
    -Trigger (New-ScheduledTaskTrigger -Daily -At $At) `
    -Action (New-ScheduledTaskAction -Execute $ps -Argument "$base -Update" -WorkingDirectory $Root) | Out-Null
  Register-ScheduledTask -TaskName $LogonTask -Force -Principal $principal -Settings $settings `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME") `
    -Action (New-ScheduledTaskAction -Execute $ps -Argument "$base -Start" -WorkingDirectory $Root) | Out-Null
  Write-Log "Scheduled '$UpdateTask' daily at $At and '$LogonTask'"
}

function Invoke-Install {
  if (-not (Test-Path $EnvFile)) { throw "No .env in $Root. Copy .env.example to .env, set a dev DATABASE_URL and PORT, then rerun." }
  foreach ($tool in 'git', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
  }
  if (-not (Get-EnvValue 'PORT')) { Write-Log 'WARN PORT not set in .env; using 5000, which clashes with a normal dev server' }
  $s3 = Get-EnvValue 'PRM_S3_ENDPOINT'
  if ($s3) {
    try { Invoke-WebRequest -Uri $s3 -UseBasicParsing -TimeoutSec 5 | Out-Null }
    catch { if (-not $_.Exception.Response) { Write-Log "WARN PRM-S3 not reachable at $s3; images won't load until it is" } }
  }

  $config = Get-Config
  $trackBranch = if ($Branch) { $Branch } elseif ($config) { $config.branch } else { Get-GitOutput @('rev-parse', '--abbrev-ref', 'HEAD') }
  $at = if ($Time) { $Time } elseif ($config) { $config.time } else { '00:00' }
  [pscustomobject]@{ branch = $trackBranch; time = $at } | ConvertTo-Json | Set-Content $ConfigFile -Encoding UTF8
  Write-Log "Tracking $trackBranch, updating daily at $at"

  try { Register-Tasks $at }
  catch { throw "Could not register the scheduled tasks ($($_.Exception.Message)). Rerun from an elevated PowerShell." }
  return Invoke-Update
}

$ok = $true
if ($Install) { $ok = Invoke-Install }
elseif ($Update) { $ok = Invoke-Update }
elseif ($Start) { $ok = Start-Prm }
elseif ($Stop) { Stop-Prm }
elseif ($Uninstall) {
  Unregister-ScheduledTask -TaskName $UpdateTask -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $LogonTask -Confirm:$false -ErrorAction SilentlyContinue
  Stop-Prm
  Write-Log "Removed '$UpdateTask' and '$LogonTask'; PRM-dev stopped"
}
else { Get-Help $PSCommandPath -Detailed; exit 0 }

if (-not $ok) { exit 1 }
