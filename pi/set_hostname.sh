#!/usr/bin/env bash
set -euo pipefail

NEW_HOSTNAME="${1:-}"

if [[ -z "$NEW_HOSTNAME" ]]; then
  echo "Usage: bash pi/set_hostname.sh <new-hostname>"
  exit 1
fi

if ! [[ "$NEW_HOSTNAME" =~ ^[a-z0-9-]+$ ]]; then
  echo "Hostname must use lowercase letters, numbers, and hyphens only."
  exit 1
fi

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

echo "Setting hostname to: $NEW_HOSTNAME"
as_root hostnamectl set-hostname "$NEW_HOSTNAME"

if as_root grep -qE '^127\.0\.1\.1\s+' /etc/hosts; then
  as_root sed -i "s/^127\\.0\\.1\\.1\s\+.*/127.0.1.1\t$NEW_HOSTNAME/" /etc/hosts
else
  as_root bash -lc "printf '\n127.0.1.1\t%s\n' '$NEW_HOSTNAME' >> /etc/hosts"
fi

as_root systemctl restart avahi-daemon || true

echo
echo "Hostname updated to $NEW_HOSTNAME."
echo "Reboot recommended for all services to pick up the new hostname:"
echo "  sudo reboot"
