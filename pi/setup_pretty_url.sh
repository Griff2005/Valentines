#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${1:-3000}"
HOSTNAME_LABEL="${2:-$(hostname)}"
NGINX_SITE="/etc/nginx/sites-available/love-board"
NGINX_ENABLED="/etc/nginx/sites-enabled/love-board"

if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || (( APP_PORT < 1 || APP_PORT > 65535 )); then
  echo "Invalid app port: $APP_PORT"
  exit 1
fi

if ! [[ "$HOSTNAME_LABEL" =~ ^[a-zA-Z0-9-]+$ ]]; then
  echo "Invalid hostname label: $HOSTNAME_LABEL"
  echo "Use only letters, numbers, and hyphens."
  exit 1
fi

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

echo "Installing Nginx + Avahi..."
as_root apt-get update
as_root apt-get install -y nginx avahi-daemon

echo "Writing Nginx reverse proxy config..."
as_root tee "$NGINX_SITE" >/dev/null <<NGINX
server {
  listen 80;
  listen [::]:80;

  server_name ${HOSTNAME_LABEL}.local ${HOSTNAME_LABEL} _;

  location / {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX

if [[ -L /etc/nginx/sites-enabled/default ]]; then
  as_root rm -f /etc/nginx/sites-enabled/default
fi

as_root ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"

as_root nginx -t
as_root systemctl enable --now nginx avahi-daemon
as_root systemctl restart nginx

echo
echo "Pretty URL proxy is active."
echo "Open: http://${HOSTNAME_LABEL}.local"
echo "(same Wi-Fi network, and love-board service must be running on port ${APP_PORT})"
