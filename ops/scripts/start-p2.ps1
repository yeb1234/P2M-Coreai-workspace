# Start the P2 stack on Windows.
# Handles the two recurring Docker Desktop + WSL GPU leftovers:
#   1. WSL's /dev/dxg is present but NVIDIA libraries are stale -> --shutdown
#   2. Docker Desktop engine is not up yet -> start it and wait for the API
#
# Usage:
#   pwsh -File scripts/start-p2.ps1
#   pwsh -File scripts/start-p2.ps1 -SkipGpuCheck
[CmdletBinding()]
param(
    [switch]$SkipGpuCheck
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$composeArgs = @(
    "-f", "docker-compose.yml",
    "-f", "docker-compose.gpu.yml",
    "-f", "docker-compose.batch.yml"
)

function Test-WslGpu {
    & wsl.exe -- nvidia-smi -L *> $null
    return $LASTEXITCODE -eq 0
}

function Wait-ForDocker {
    param([int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        & docker info --format "{{.ServerVersion}}" *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 2
    }
    throw "Docker engine did not become ready within $TimeoutSeconds seconds."
}

if (-not $SkipGpuCheck) {
    if (-not (Test-WslGpu)) {
        Write-Host "WSL GPU not ready; restarting WSL..."
        & wsl.exe --shutdown
        Start-Sleep -Seconds 8
        if (-not (Test-WslGpu)) {
            throw "WSL GPU still unavailable after wsl --shutdown. Check the Windows NVIDIA driver."
        }
        Write-Host "WSL GPU restored."
    }
}

& docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) {
    $dockerDesktop = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if (-not $dockerDesktop) {
        throw "Docker engine is down and Docker Desktop.exe was not found."
    }
    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $dockerDesktop | Out-Null
    Wait-ForDocker
}

Write-Host "Starting P2 stack..."
& docker compose @composeArgs up -d

$backendName = "p2-siteyeb-backend-1"
for ($i = 0; $i -lt 60; $i++) {
    $status = & docker inspect -f "{{.State.Health.Status}}" $backendName 2>$null
    if ($status -eq "healthy") { break }
    Start-Sleep -Seconds 2
}

& docker ps --filter "name=p2-siteyeb" --format "table {{.Names}}\t{{.Status}}"
Write-Host "P2 stack is up. GPU workers use the startup recovery lock; no manual WORKER_SECONDARY override is needed."
