# Nightly local pipeline runner — invoked by Windows Task Scheduler.
# Pulls latest Megaphone RSS, transcribes any new episode with two-pass Whisper,
# commits transcripts to the repo, and pushes. The scheduled-routine on
# Anthropic infrastructure picks it up next.
#
# Install with deploy/install_task.ps1 (one-time).
# Log: %USERPROFILE%\predictable-nightly.log

$ErrorActionPreference = "Stop"
$repo = "$env:USERPROFILE\Documents\GitHub\anythingimake\predictable"
$log = "$env:USERPROFILE\predictable-nightly.log"

function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format o) $m" }

Log "=== run start ==="
Set-Location $repo

try {
    Log "git pull"
    git pull --ff-only origin main 2>&1 | Out-File -FilePath $log -Append -Encoding utf8

    Log "ingest + transcribe (pass 1 only)"
    & python -m pipeline.backfill --skip-pass2 2>&1 | Out-File -FilePath $log -Append -Encoding utf8

    Log "stage transcripts + ingest snapshots"
    git add data/transcripts/ data/ingest/ 2>&1 | Out-File -FilePath $log -Append -Encoding utf8

    $changes = git status --short data/
    if ($changes) {
        Log "commit + push"
        $stamp = Get-Date -Format "yyyy-MM-dd"
        git commit -m "Nightly transcripts $stamp" 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
        git push 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    } else {
        Log "no new transcripts to commit"
    }

    Log "=== run done ==="
} catch {
    Log "ERROR: $_"
    exit 1
}
