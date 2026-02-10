#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="love-board"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANCH="${1:-}"
RUN_USER="${SUDO_USER:-$USER}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Not a git repository: $APP_DIR"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not installed."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed."
  exit 1
fi

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
fi

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_user() {
  if [[ "$(id -un)" == "$RUN_USER" ]]; then
    "$@"
  else
    sudo -u "$RUN_USER" "$@"
  fi
}

echo "Updating repository in $APP_DIR (branch: $BRANCH)..."
as_user git -C "$APP_DIR" fetch --all --prune
as_user git -C "$APP_DIR" checkout "$BRANCH"
as_user git -C "$APP_DIR" pull --ff-only

echo "Installing production dependencies..."
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  as_user npm --prefix "$APP_DIR" ci --omit=dev --no-audit --no-fund
else
  as_user npm --prefix "$APP_DIR" install --omit=dev --no-audit --no-fund
fi

echo "Restarting $SERVICE_NAME..."
as_root systemctl restart "$SERVICE_NAME"

sleep 1
as_root systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
echo "Update complete."
echo "Tail logs with: sudo journalctl -u $SERVICE_NAME -f"
