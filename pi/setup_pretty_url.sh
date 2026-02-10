#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${1:-3000}"
HOSTNAME_LABEL="${2:-$(hostname)}"
NGINX_SITE="/etc/nginx/sites-available/love-board"
NGINX_ENABLED="/etc/nginx/sites-enabled/love-board"
AVAHI_HOSTS_FILE="/etc/avahi/hosts"

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
as_root apt-get install -y nginx avahi-daemon avahi-utils

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

PI_IP="$(hostname -I | awk '{print $1}')"
if [[ -n "$PI_IP" ]]; then
  echo "Publishing mDNS alias ${HOSTNAME_LABEL}.local -> ${PI_IP}"

  TMP_FILE="$(mktemp)"
  if as_root test -f "$AVAHI_HOSTS_FILE"; then
    as_root cat "$AVAHI_HOSTS_FILE" | awk -v name="$HOSTNAME_LABEL" '
      {
        keep = 1
        for (i = 2; i <= NF; i++) {
          if ($i == name || $i == (name ".local")) {
            keep = 0
          }
        }
        if (keep) {
          print
        }
      }
    ' > "$TMP_FILE"
  fi

  printf "%s %s.local %s\n" "$PI_IP" "$HOSTNAME_LABEL" "$HOSTNAME_LABEL" >> "$TMP_FILE"
  as_root install -m 644 "$TMP_FILE" "$AVAHI_HOSTS_FILE"
  rm -f "$TMP_FILE"
else
  echo "Warning: could not detect Pi IP for mDNS alias publishing."
fi

as_root nginx -t
as_root systemctl enable --now nginx avahi-daemon
as_root systemctl restart nginx
as_root systemctl restart avahi-daemon

echo
echo "Pretty URL proxy is active."
echo "Open: http://${HOSTNAME_LABEL}.local"
echo "(same Wi-Fi network, and love-board service must be running on port ${APP_PORT})"
