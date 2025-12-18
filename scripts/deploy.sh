#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/deploy.sh [options]

Runs 7min deploy steps in a safe order:
  - optional git pull
  - npm install (root 7min + client) only when needed
  - db migrate only when needed
  - build client
  - optional reload caddy + restart 7min.service

Options:
  --pull              Run git pull in repo root first
  --restart           Reload caddy and restart 7min.service (uses sudo)
  --no-restart        Do not restart services (default)
  --force-install     Always run npm install for 7min and client
  --force-migrate     Always run migrations
  --no-backup         Disable pre-pull backup (default: enabled when --pull is used)
  --healthcheck URL   Ping URL after restart (default: https://localhost/api/health)
  --no-healthcheck    Skip health check (default: enabled when --restart is used)
  -h, --help          Show this help

Examples:
  bash scripts/deploy.sh --pull --restart
  bash scripts/deploy.sh --restart
USAGE
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^(DB_PATH|UPLOAD_DIR|BACKUP_DIR)= ]]; then
      export "$line"
    fi
  done <"$env_file"
}

ensure_npm_install() {
  local dir="$1"
  local force="${2:-0}"

  if [[ "$force" == "1" ]]; then
    echo "[deploy] npm install (forced) in $dir"
    npm --prefix "$dir" install
    return 0
  fi

  if [[ ! -d "$dir/node_modules" ]]; then
    echo "[deploy] npm install in $dir (node_modules missing)"
    npm --prefix "$dir" install
    return 0
  fi

  if [[ -f "$dir/package-lock.json" && -f "$dir/node_modules/.package-lock.json" ]]; then
    if ! cmp -s "$dir/package-lock.json" "$dir/node_modules/.package-lock.json"; then
      echo "[deploy] npm install in $dir (lockfile changed)"
      npm --prefix "$dir" install
      return 0
    fi
  fi

  echo "[deploy] npm install skipped in $dir"
}

needs_migrate() {
  local db_path="$1"
  local migrations_dir="$2"

  if [[ ! -f "$db_path" ]]; then
    return 0
  fi

  if ! need_cmd sqlite3; then
    return 0
  fi

  # If migrations table is missing, we need to run migrate.
  if ! sqlite3 "$db_path" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations';" | grep -q 1; then
    return 0
  fi

  local tmp_applied tmp_files
  tmp_applied="$(mktemp)"
  tmp_files="$(mktemp)"
  trap 'rm -f "$tmp_applied" "$tmp_files"' RETURN

  sqlite3 "$db_path" "SELECT id FROM migrations ORDER BY id;" >"$tmp_applied" || true
  find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print \
    | sed 's#.*/##' \
    | sed 's/\.sql$//' \
    | sort >"$tmp_files"

  # If any migration file is not in applied => need migrate.
  if comm -23 "$tmp_files" "$tmp_applied" | grep -q .; then
    return 0
  fi

  return 1
}

PULL=0
RESTART=0
FORCE_INSTALL=0
FORCE_MIGRATE=0
PRE_PULL_BACKUP=1
HEALTHCHECK_ENABLED=1
HEALTHCHECK_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) PULL=1; shift ;;
    --restart) RESTART=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    --force-install) FORCE_INSTALL=1; shift ;;
    --force-migrate) FORCE_MIGRATE=1; shift ;;
    --no-backup) PRE_PULL_BACKUP=0; shift ;;
    --healthcheck) HEALTHCHECK_URL="${2:-}"; shift 2 ;;
    --no-healthcheck) HEALTHCHECK_ENABLED=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 2 ;;
  esac
done

ROOT="$(repo_root)"
if [[ -z "${ROOT:-}" ]]; then
  echo "[deploy] Not inside a git repo."
  exit 2
fi

SEVENMIN="$ROOT/7min"
CLIENT="$SEVENMIN/client"
MIGRATIONS_DIR="$SEVENMIN/server/db/migrations"
load_env_file "$SEVENMIN/.env"
DB_PATH="${DB_PATH:-$SEVENMIN/server/data/app.db}"

if [[ "$PULL" == "1" ]]; then
  if [[ "$PRE_PULL_BACKUP" == "1" ]]; then
    if [[ -f "$ROOT/scripts/backup.sh" ]]; then
      echo "[deploy] backup (pre-pull)"
      bash "$ROOT/scripts/backup.sh" --kind pre-pull || {
        echo "[deploy] backup failed; aborting deploy (use --no-backup to skip)."
        exit 1
      }
    else
      echo "[deploy] backup script missing; skipping backup"
    fi
  fi
  echo "[deploy] git pull"
  (cd "$ROOT" && git pull)
fi

echo "[deploy] deps"
ensure_npm_install "$SEVENMIN" "$FORCE_INSTALL"
ensure_npm_install "$CLIENT" "$FORCE_INSTALL"

echo "[deploy] migrate"
if [[ "$FORCE_MIGRATE" == "1" ]]; then
  echo "[deploy] npm run migrate (forced)"
  (cd "$SEVENMIN" && npm run migrate)
else
  if needs_migrate "$DB_PATH" "$MIGRATIONS_DIR"; then
    echo "[deploy] npm run migrate (needed)"
    (cd "$SEVENMIN" && npm run migrate)
  else
    echo "[deploy] migrate skipped (no new migrations)"
  fi
fi

echo "[deploy] build"
(cd "$SEVENMIN" && npm run build)

if [[ "$RESTART" == "1" ]]; then
  if ! need_cmd systemctl; then
    echo "[deploy] systemctl not found; skipping restart."
    exit 0
  fi
  echo "[deploy] reload caddy"
  sudo systemctl reload caddy
  echo "[deploy] restart 7min.service"
  sudo systemctl restart 7min.service

  if [[ "$HEALTHCHECK_ENABLED" == "1" ]]; then
    if [[ -z "$HEALTHCHECK_URL" ]]; then
      HEALTHCHECK_URL="https://localhost/api/health"
    fi
    echo "[deploy] healthcheck: $HEALTHCHECK_URL"
    ok=0
    for i in {1..20}; do
      if need_cmd curl; then
        if curl -fsS --max-time 3 "$HEALTHCHECK_URL" >/dev/null 2>&1; then ok=1; break; fi
      elif need_cmd wget; then
        if wget -q -T 3 -O /dev/null "$HEALTHCHECK_URL" >/dev/null 2>&1; then ok=1; break; fi
      else
        echo "[deploy] curl/wget not found; skipping healthcheck."
        ok=1
        break
      fi
      sleep 1
    done
    if [[ "$ok" != "1" ]]; then
      echo "[deploy] healthcheck FAILED (service may be down)."
      echo "[deploy] Tip: sudo journalctl -u 7min.service -n 200 --no-pager"
      exit 1
    fi
    echo "[deploy] healthcheck OK"
  fi
fi

echo "[deploy] done"
