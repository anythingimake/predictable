# Register the nightly Predictable pipeline as a Windows scheduled task.
# Runs once: PowerShell deploy/install_task.ps1
#
# The task fires daily at 2:05am local time. If the machine is asleep at
# fire time, Task Scheduler will run it as soon as it wakes up (StartWhenAvailable).

$repo = "$env:USERPROFILE\Documents\GitHub\anythingimake\predictable"
$script = "$repo\deploy\nightly_local.ps1"
$taskName = "Predictable_Nightly_Pipeline"

if (-not (Test-Path $script)) {
    Write-Error "Script not found: $script"
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""

$trigger = New-ScheduledTaskTrigger -Daily -At 2:05am

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Remove any existing task with the same name
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Predictable: nightly Megaphone ingest + Whisper transcribe + git push"

Write-Host "Registered scheduled task: $taskName"
Write-Host "Next run: 2:05am daily"
Write-Host "Log: $env:USERPROFILE\predictable-nightly.log"
Write-Host ""
Write-Host "Run it now to test:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
