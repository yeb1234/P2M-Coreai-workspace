# P2 CPU WAV / audio-prep console
# One visible window for observability. Child ffmpeg processes stay hidden.
$ErrorActionPreference = "Continue"
$Title = "P2 CPU WAV / audio-prep"
$Container = "p2-siteyeb-audio-prep-1"
$Docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

try { $Host.UI.RawUI.WindowTitle = $Title } catch {}

# Single visible console only. Double-clicking again should not create another.
$existing = @(Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -eq $Title
})
if ($existing.Count -gt 0) {
    Write-Host "P2 CPU WAV console is already open. Reusing that window." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    exit 0
}

function Show-Header {
    Clear-Host
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host " P2 CPU WAV / audio-prep console" -ForegroundColor Cyan
    Write-Host " container: $Container" -ForegroundColor Gray
    Write-Host " logs:      /data/logs/audio-prep.jsonl (inside container)" -ForegroundColor Gray
    Write-Host " note:      ffmpeg children run with CREATE_NO_WINDOW" -ForegroundColor DarkGray
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host ""
}

Show-Header

if (-not (Test-Path -LiteralPath $Docker)) {
    Write-Host "Docker CLI not found: $Docker" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$status = (& $Docker inspect -f '{{.State.Status}}' $Container 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Write-Host "Container not found: $Container" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Current state: $status" -ForegroundColor Gray
if ($status -ne "running") {
    Write-Host "Starting $Container ..." -ForegroundColor Yellow
    & $Docker start $Container
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Following logs. Close this window to stop following; the container keeps running." -ForegroundColor DarkGray
Write-Host ""

# This command blocks while the container is alive. If the container exits,
# the window stays open below so the final log and exit code remain visible.
& $Docker logs --tail 80 -f $Container

$exitCode = $LASTEXITCODE
Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkYellow
Write-Host " Log stream ended. docker logs exit code: $exitCode" -ForegroundColor Yellow
$state = (& $Docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}' $Container 2>$null | Out-String).Trim()
Write-Host " Final state: $state" -ForegroundColor Yellow
Write-Host " Last 40 log lines:" -ForegroundColor Yellow
& $Docker logs --tail 40 $Container 2>&1
Write-Host ""
Write-Host "This window is intentionally kept open for crash traceability." -ForegroundColor DarkGray
Read-Host "Press Enter to close"
