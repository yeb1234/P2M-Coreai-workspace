#!/usr/bin/env bash
# 共享 PostgreSQL 首次初始化：按 database/role 隔离 P1~P4。
#
# 由 postgres 官方镜像的 /docker-entrypoint-initdb.d 调用，只在数据目录为空时执行。
# 口令从容器环境读取，不写进仓库；同名角色/库已存在时只更新口令，不重复创建。
#
# 额外兼容 P1 最终稿：P1 的 app 角色是 slimtrack_app（RLS 用），
# 如果设置了 P1_APP_PASSWORD，就把它建出来并只授予 db_p1 的 CRUD 权限。

set -Eeuo pipefail

SUPERUSER="${POSTGRES_USER:-postgres}"

provision_project() {
  local role="$1"
  local db="$2"
  local password="$3"

  if [[ -z "$password" ]]; then
    echo "[shared-db] skip ${db}: ${role} 口令为空"
    return 0
  fi

  echo "[shared-db] provision ${db} owner=${role}"
  psql -v ON_ERROR_STOP=1 --username "$SUPERUSER" --dbname postgres \
    -v role="$role" -v db="$db" -v pw="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'role', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', :'db', :'role', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'role') \gexec
SQL

  psql -v ON_ERROR_STOP=1 --username "$SUPERUSER" --dbname "$db" \
    -v role="$role" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'role') \gexec
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'role') \gexec
SQL
}

grant_p1_app_role() {
  local password="${P1_APP_PASSWORD:-}"
  if [[ -z "$password" ]]; then
    return 0
  fi

  echo "[shared-db] provision P1 app role slimtrack_app on db_p1"
  psql -v ON_ERROR_STOP=1 --username "$SUPERUSER" --dbname postgres \
    -v pw="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'slimtrack_app', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slimtrack_app') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'slimtrack_app', :'pw') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', 'db_p1', 'slimtrack_app') \gexec
SQL

  psql -v ON_ERROR_STOP=1 --username "$SUPERUSER" --dbname db_p1 <<'SQL'
SELECT format('GRANT USAGE ON SCHEMA public TO %I', 'slimtrack_app') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', 'slimtrack_app') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', 'slimtrack_app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', 'u_p1', 'slimtrack_app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', 'u_p1', 'slimtrack_app') \gexec
SQL
}

provision_project "u_p1" "db_p1" "${P1_DB_PASSWORD:-}"
provision_project "u_p2" "db_p2" "${P2_DB_PASSWORD:-}"
provision_project "u_p3" "db_p3" "${P3_DB_PASSWORD:-}"
provision_project "u_p4" "db_p4" "${P4_DB_PASSWORD:-}"
provision_project "u_p2_demo" "db_p2_demo" "${P2_DEMO_DB_PASSWORD:-}"
grant_p1_app_role

echo "[shared-db] done"
