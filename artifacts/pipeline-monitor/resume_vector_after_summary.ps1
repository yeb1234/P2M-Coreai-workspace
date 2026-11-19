$ErrorActionPreference = 'Stop'
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$log = Join-Path $PSScriptRoot 'resume_vector_after_summary.log'
$deadline = (Get-Date).AddHours(14)

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}

Write-Log 'watchdog started: wait for summary backlog to drain, then start vector worker'

while ((Get-Date) -lt $deadline) {
  try {
    $queue = [int]((& $docker exec p2-siteyeb-redis-1 redis-cli LLEN rq:queue:summary_jobs) | Select-Object -First 1)
    $state = ((& $docker exec p2-siteyeb-redis-1 redis-cli --raw HGET rq:worker:summary-worker-laptop state) | Select-Object -First 1)
    Write-Log "summary_queue=$queue summary_state=$state"
    if ($queue -le 20 -and $state.Trim() -ne 'busy') {
      & $docker start p2-siteyeb-vector-worker-1 | Out-Null
      Write-Log 'vector worker started; watchdog exit'
      exit 0
    }
  } catch {
    Write-Log "check failed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 300
}

Write-Log 'watchdog deadline reached; starting vector worker anyway'
& $docker start p2-siteyeb-vector-worker-1 | Out-Null
Write-Log 'vector worker started; watchdog exit'
