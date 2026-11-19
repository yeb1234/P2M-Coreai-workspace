# P2 handoff: after all transcription jobs finish, load desktop Qwen and split
# the remaining summary queue between laptop (shard 0) and desktop (shard 1).
# Run every 5 minutes by a Scheduled Task. It exits immediately while any
# transcription job is still queued/running.
$ErrorActionPreference = "Stop"

$Root = "C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4"
$Marker = Join-Path $Root ".runtime\p2_desktop_qwen_handoff.done"
$LogDir = Join-Path $Root "logs"
$Log = Join-Path $LogDir "p2_desktop_qwen_handoff.log"
$Lms = "C:\Users\yeb12\.lmstudio\bin\lms.exe"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $Marker) | Out-Null

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -LiteralPath $Log -Value $line -Encoding utf8
}

if (Test-Path -LiteralPath $Marker) {
    exit 0
}

try {
    $activeText = (& docker exec p2-siteyeb-postgres-1 psql -U p2user -d p2learning -Atc "select count(*) from ai_jobs where do_summary=false and status in ('queued','running');" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Write-Log "database check failed"
        exit 1
    }
    $active = [int]$activeText
    if ($active -gt 0) {
        exit 0
    }

    $pendingText = (& docker exec p2-siteyeb-postgres-1 psql -U p2user -d p2learning -Atc "select count(*) from videos where coalesce(summary,'')='' and coalesce(transcription,'')<>'';" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Write-Log "pending summary check failed"
        exit 1
    }
    $pending = [int]$pendingText
    if ($pending -le 0) {
        Write-Log "no pending summaries; nothing to hand off"
        exit 0
    }

    Write-Log "transcription queue empty; pending summaries=$pending; checking desktop Qwen"
    $psText = (& $Lms ps 2>&1 | Out-String)
    if ($psText -notmatch "qwen/qwen3-4b-2507") {
        Write-Log "loading desktop qwen 16k"
        $loadText = (& $Lms load "qwen/qwen3-4b-2507" -c 16384 --parallel 1 --gpu max -y 2>&1 | Out-String)
        Write-Log $loadText
        Start-Sleep -Seconds 5
        $psText = (& $Lms ps 2>&1 | Out-String)
    }
    if ($psText -notmatch "qwen/qwen3-4b-2507") {
        Write-Log "desktop qwen load failed; retry next cycle"
        exit 1
    }

    # Stop the current all-in-one laptop worker, then restart it as shard 0.
    & docker exec p2-siteyeb-backend-1 python /tmp/stop_unified.py 2>&1 | Out-String | ForEach-Object { Write-Log $_ }
    Start-Sleep -Seconds 2

    & docker exec -d -w /app -e PYTHONPATH=/app -e SUMMARY_SHARDS=2 -e SUMMARY_SHARD=0 -e SUMMARY_FAILED_FILE=/tmp/parallel_summary_laptop_failed.json p2-siteyeb-backend-1 sh -c "nohup python /tmp/parallel_summary_unified.py > /tmp/parallel_summary_laptop_after_handoff.log 2>&1 &"
    if ($LASTEXITCODE -ne 0) {
        Write-Log "failed to start laptop shard 0"
        exit 1
    }

    & docker exec -d -w /app -e PYTHONPATH=/app -e LAPTOP_BASE_URL=http://host.docker.internal:1235/v1 -e SUMMARY_SHARDS=2 -e SUMMARY_SHARD=1 -e SUMMARY_FAILED_FILE=/tmp/parallel_summary_desktop_failed.json p2-siteyeb-backend-1 sh -c "nohup python /tmp/parallel_summary_unified.py > /tmp/parallel_summary_desktop.log 2>&1 &"
    if ($LASTEXITCODE -ne 0) {
        Write-Log "failed to start desktop shard 1"
        exit 1
    }

    Start-Sleep -Seconds 15
    $laptopLog = (& docker exec p2-siteyeb-backend-1 tail -n 8 /tmp/parallel_summary_laptop_after_handoff.log 2>&1 | Out-String)
    $desktopLog = (& docker exec p2-siteyeb-backend-1 tail -n 8 /tmp/parallel_summary_desktop.log 2>&1 | Out-String)
    if ($laptopLog -match "unified queue pending=" -and $desktopLog -match "unified queue pending=") {
        Set-Content -LiteralPath $Marker -Value "handoff completed $(Get-Date -Format s)" -Encoding utf8
        Write-Log "handoff complete: laptop shard 0 + desktop shard 1"
        Write-Log $laptopLog
        Write-Log $desktopLog
    } else {
        Write-Log "worker startup verification failed; will retry"
        Write-Log $laptopLog
        Write-Log $desktopLog
        exit 1
    }
} catch {
    Write-Log "error: $($_.Exception.Message)"
    exit 1
}
