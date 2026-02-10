#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="love-board"
DEFAULT_PORT="3000"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${1:-$DEFAULT_APP_DIR}"
RUN_USER="${2:-${SUDO_USER:-$USER}}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory does not exist: $APP_DIR"
  exit 1
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "User does not exist: $RUN_USER"
  exit 1
fi

RUN_GROUP="$(id -gn "$RUN_USER")"
ENV_FILE="/etc/${SERVICE_NAME}.env"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

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

echo "Installing OS packages..."
as_root apt-get update
as_root apt-get install -y nodejs npm build-essential python3 curl ca-certificates

cd "$APP_DIR"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is not installed or not in PATH after installation."
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 18 )); then
  echo "Detected Node.js version too old for this app. Installing Node.js 20..."
  as_root bash -lc 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -'
  as_root apt-get install -y nodejs

  NODE_BIN="$(command -v node || true)"
  if [[ -z "$NODE_BIN" ]]; then
    echo "Node.js upgrade failed."
    exit 1
  fi

  NODE_MAJOR="$("$NODE_BIN" -p "Number(process.versions.node.split('.')[0])")"
  if (( NODE_MAJOR < 18 )); then
    echo "Node.js version is still too old. Need >= 18."
    exit 1
  fi
fi

echo "Installing Node dependencies in $APP_DIR..."
if [[ -f package-lock.json ]]; then
  as_user npm ci --omit=dev --no-audit --no-fund
else
  as_user npm install --omit=dev --no-audit --no-fund
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Writing environment file: $ENV_FILE"
  as_root tee "$ENV_FILE" >/dev/null <<ENVVARS
NODE_ENV=production
PORT=$DEFAULT_PORT
HOST=0.0.0.0
# Optional: enable browser login prompt when opening the site.
# BASIC_AUTH_USER=your_username
# BASIC_AUTH_PASS=your_password
ENVVARS

  as_root chown root:root "$ENV_FILE"
  as_root chmod 600 "$ENV_FILE"
else
  echo "Keeping existing environment file: $ENV_FILE"
fi

echo "Writing systemd service: $SERVICE_FILE"
as_root tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=Lyda Board Remote Web Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE

as_root systemctl daemon-reload
as_root systemctl enable --now "$SERVICE_NAME"

PI_IP="$(hostname -I | awk '{print $1}')"
PI_HOSTNAME="$(hostname)"

echo
echo "Service installed and started: $SERVICE_NAME"
echo "Check status: sudo systemctl status $SERVICE_NAME"
echo "View logs:    sudo journalctl -u $SERVICE_NAME -f"
echo
if [[ -n "$PI_IP" ]]; then
  echo "Phone access (same Wi-Fi): http://$PI_IP:$DEFAULT_PORT"
fi
echo "mDNS hostname URL:         http://${PI_HOSTNAME}.local:$DEFAULT_PORT"
