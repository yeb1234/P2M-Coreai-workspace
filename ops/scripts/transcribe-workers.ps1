# 切换转写 worker 数量：默认 1 个，需要临时翻倍时显式开 2 个。
#
#   pwsh -File ops/scripts/transcribe-workers.ps1 -Count 1
#   pwsh -File ops/scripts/transcribe-workers.ps1 -Count 2
#
# 单 worker 时 worker2 保持停止；双 worker 通过 compose profile
# dual-transcribe 启动，不影响其他服务。
[CmdletBinding()]
param(
    [ValidateSet(1, 2)]
    [int]$Count = 1
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$composeArgs = @(
    "compose", "-p", "p2-siteyeb",
    "--env-file", ".env",
    "-f", "infra/docker-compose.yml",
    "-f", "infra/docker-compose.batch.yml"
)

if ($Count -eq 2) {
    Write-Host "Starting dual transcribe workers..."
    & docker @composeArgs --profile dual-transcribe up -d worker worker2
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
} else {
    Write-Host "Keeping a single transcribe worker..."
    # worker2 可能还没创建过；stop 失败不影响主 worker。
    & docker @composeArgs stop worker2 *> $null
    & docker @composeArgs up -d worker
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
}

& docker ps --filter "name=p2-siteyeb-worker" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
