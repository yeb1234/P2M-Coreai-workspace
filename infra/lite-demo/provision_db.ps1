param(
    [string]$DemoEnv = (Join-Path $PSScriptRoot ".env"),
    [string]$SharedEnv = (Join-Path (Split-Path $PSScriptRoot -Parent) "shared\.env"),
    [string]$Container = "shared-postgres"
)

$ErrorActionPreference = "Stop"

function Read-EnvFile([string]$Path) {
    $map = @{}
    Get-Content -LiteralPath $Path | ForEach-Object {
        if ($_ -match '^([^#][^=]*)=(.*)$') {
            $map[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    return $map
}

$demo = Read-EnvFile $DemoEnv
$shared = Read-EnvFile $SharedEnv

if (-not $demo.ContainsKey("DATABASE_URL")) {
    throw "demo .env 缺少 DATABASE_URL"
}
if (-not $shared.ContainsKey("SHARED_PG_SUPERUSER") -or -not $shared.ContainsKey("SHARED_PG_SUPERPASSWORD")) {
    throw "shared .env 缺少 SHARED_PG_SUPERUSER / SHARED_PG_SUPERPASSWORD"
}

if ($demo["DATABASE_URL"] -notmatch '://u_p2_demo:([^@]+)@[^/]+/db_p2_demo') {
    throw "DATABASE_URL 不是预期的 db_p2_demo / u_p2_demo"
}
$demoPassword = $matches[1]
$superUser = $shared["SHARED_PG_SUPERUSER"]
$superPassword = $shared["SHARED_PG_SUPERPASSWORD"]

@'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'u_p2_demo', :'rolpw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'u_p2_demo') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'u_p2_demo', :'rolpw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', 'db_p2_demo', 'u_p2_demo', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'db_p2_demo') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', 'db_p2_demo', 'u_p2_demo') \gexec
'@ | docker exec -i -e PGPASSWORD=$superPassword $Container psql -v ON_ERROR_STOP=1 --username $superUser --dbname postgres -v rolpw=$demoPassword

@'
SELECT format('ALTER SCHEMA public OWNER TO %I', 'u_p2_demo') \gexec
SELECT format('GRANT ALL ON SCHEMA public TO %I', 'u_p2_demo') \gexec
'@ | docker exec -i -e PGPASSWORD=$superPassword $Container psql -v ON_ERROR_STOP=1 --username $superUser --dbname db_p2_demo

Write-Output "db_p2_demo / u_p2_demo is ready on $Container"
