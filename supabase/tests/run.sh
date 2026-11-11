#!/usr/bin/env bash
# Applies every migration to a fresh throwaway database on a LOCAL PostgreSQL
# and runs the access-rule tests. It never touches the real Supabase project.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="rightdrop_test_$$"
P=(psql -v ON_ERROR_STOP=1 -q)
"${P[@]}" -d postgres -c "CREATE DATABASE $DB"
cleanup() {
  "${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
  # The shim's roles are cluster-wide; remove them so the next run starts clean.
  "${P[@]}" -d postgres -c "DROP ROLE IF EXISTS anon; DROP ROLE IF EXISTS authenticated; DROP ROLE IF EXISTS service_role" >/dev/null 2>&1 || true
}
trap cleanup EXIT
export PGOPTIONS="-c client_min_messages=warning"
"${P[@]}" -d "$DB" -f tests/00_supabase_shim.sql
for f in migrations/*.sql; do
  "${P[@]}" -d "$DB" -f "$f"
done
echo "Applied $(ls migrations/*.sql | wc -l) migrations."
PGOPTIONS="" "${P[@]}" -d "$DB" -f tests/rls_test.sql
