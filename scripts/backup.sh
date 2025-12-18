#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/backup.sh --kind pre-pull|daily|weekly [options]

Creates a SQLite backup (and optionally uploads/ media) with a fixed filename so you
always keep exactly 3 rolling backups:
  - pre-pull  (overwritten each deploy pull)
  - daily     (overwritten each day)
  - weekly    (overwritten each week)

Options:
  --kind KIND            Required: pre-pull | daily | weekly
  --backup-dir DIR       Where to store backups (default: /var/backups/7min if writable, else ~/7min-backups)
  --db-path PATH         SQLite DB path (default: $DB_PATH or repo/7min/server/data/app.db)
  --uploads-dir DIR      Uploads dir (default: $UPLOAD_DIR or repo/7min/server/uploads)
  --no-uploads           Do not backup uploads/
  -h, --help             Show help

Environment:
  DB_PATH, UPLOAD_DIR, BACKUP_DIR
USAGE
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

repo_root() { git rev-parse --show-toplevel 2>/dev/null || true; }

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

backup_with_sqlite3() {
  local src="$1"
  local dest="$2"
  sqlite3 "$src" ".timeout 5000" ".backup '$dest'"
  local check
  check="$(sqlite3 "$dest" "PRAGMA quick_check;" | head -n 1 || true)"
  [[ "$check" == "ok" ]]
}

backup_with_node() {
  local sevenmin_dir="$1"
  local src="$2"
  local dest="$3"
  node - <<'NODE' "$sevenmin_dir" "$src" "$dest"
const path = require('path');
const sevenminDir = process.argv[2];
const src = process.argv[3];
const dest = process.argv[4];

process.chdir(sevenminDir);

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('[backup] Node fallback failed: better-sqlite3 is not available.');
  process.exit(2);
}

const srcDb = new Database(src, { timeout: 5000 });
srcDb.pragma('foreign_keys = ON');

srcDb
  .backup(dest)
  .then(() => {
    srcDb.close();
    const verifyDb = new Database(dest, { readonly: true, timeout: 5000 });
    const rows = verifyDb.prepare('PRAGMA quick_check;').all();
    verifyDb.close();
    const ok = rows.every((r) => Object.values(r)[0] === 'ok');
    if (!ok) {
      console.error('[backup] quick_check failed');
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    try { srcDb.close(); } catch (_) {}
    console.error('[backup] Node backup failed:', err && err.message ? err.message : String(err));
    process.exit(1);
  });
NODE
}

KIND=""
BACKUP_DIR="${BACKUP_DIR:-}"
DB_PATH="${DB_PATH:-}"
UPLOADS_DIR="${UPLOAD_DIR:-}"
INCLUDE_UPLOADS=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --db-path) DB_PATH="${2:-}"; shift 2 ;;
    --uploads-dir) UPLOADS_DIR="${2:-}"; shift 2 ;;
    --no-uploads) INCLUDE_UPLOADS=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 2 ;;
  esac
done

if [[ -z "$KIND" ]]; then
  echo "[backup] Missing --kind"
  usage
  exit 2
fi
if [[ "$KIND" != "pre-pull" && "$KIND" != "daily" && "$KIND" != "weekly" ]]; then
  echo "[backup] Invalid kind: $KIND"
  exit 2
fi

ROOT="$(repo_root)"
if [[ -z "${ROOT:-}" ]]; then
  echo "[backup] Not inside a git repo."
  exit 2
fi

SEVENMIN="$ROOT/7min"
DEFAULT_DB="$SEVENMIN/server/data/app.db"
DEFAULT_UPLOADS="$SEVENMIN/server/uploads"

load_env_file "$SEVENMIN/.env"

if [[ -z "${DB_PATH:-}" ]]; then
  DB_PATH="$DEFAULT_DB"
fi
if [[ -z "${UPLOADS_DIR:-}" ]]; then
  UPLOADS_DIR="$DEFAULT_UPLOADS"
fi

choose_backup_dir() {
  local candidate="$1"
  if [[ -n "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi
  if [[ -d "/var/backups" && -w "/var/backups" ]]; then
    echo "/var/backups/7min"
    return 0
  fi
  echo "$HOME/7min-backups"
}

BACKUP_DIR="$(choose_backup_dir "$BACKUP_DIR")"
mkdir -p "$BACKUP_DIR"

LOCKFILE="$BACKUP_DIR/.lock"
exec 9>"$LOCKFILE"
if need_cmd flock; then
  flock -n 9 || { echo "[backup] Another backup is running, exiting."; exit 0; }
fi

ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
git_rev="$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

out_db="$BACKUP_DIR/$KIND.sqlite3"
tmp_db="$BACKUP_DIR/.tmp.$KIND.$$.sqlite3"

if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup] DB not found: $DB_PATH"
  exit 1
fi

echo "[backup] Writing SQLite backup ($KIND) -> $out_db"
if need_cmd sqlite3; then
  if ! backup_with_sqlite3 "$DB_PATH" "$tmp_db"; then
    echo "[backup] sqlite3 quick_check failed"
    rm -f "$tmp_db"
    exit 1
  fi
else
  echo "[backup] sqlite3 not installed; trying Node fallback via better-sqlite3"
  if ! need_cmd node; then
    echo "[backup] node not installed; cannot create SQLite backup."
    exit 1
  fi
  if ! backup_with_node "$SEVENMIN" "$DB_PATH" "$tmp_db"; then
    echo "[backup] Node fallback failed; cannot create SQLite backup."
    rm -f "$tmp_db"
    exit 1
  fi
fi

mv -f "$tmp_db" "$out_db"

meta="$BACKUP_DIR/$KIND.meta.txt"
{
  echo "kind=$KIND"
  echo "created_at_utc=$ts"
  echo "git_rev=$git_rev"
  echo "db_path=$DB_PATH"
  echo "db_bytes=$(wc -c <"$out_db" | tr -d ' ')"
} >"$meta"

if [[ "$INCLUDE_UPLOADS" == "1" ]]; then
  if [[ -d "$UPLOADS_DIR" ]] && find "$UPLOADS_DIR" -mindepth 1 -print -quit | grep -q .; then
    out_up="$BACKUP_DIR/$KIND.uploads.tar.gz"
    tmp_up="$BACKUP_DIR/.tmp.$KIND.$$.uploads.tar.gz"
    echo "[backup] Writing uploads backup ($KIND) -> $out_up"
    tar -czf "$tmp_up" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
    mv -f "$tmp_up" "$out_up"
  else
    echo "[backup] uploads dir empty/missing; skipping uploads backup"
  fi
fi

echo "[backup] done"
