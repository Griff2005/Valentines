#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$HOME/rpi-rgb-led-matrix"

sudo apt-get update
sudo apt-get install -y \
  git \
  python3-dev \
  python3-pip \
  python3-pillow \
  python3-setuptools \
  python3-wheel \
  cython3 \
  build-essential

if [[ ! -d "$PROJECT_DIR" ]]; then
  git clone https://github.com/hzeller/rpi-rgb-led-matrix "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"
make build-python PYTHON=$(command -v python3)
sudo make install-python PYTHON=$(command -v python3)

echo
echo "Pi setup complete. Python bindings for rpi-rgb-led-matrix are installed."
echo "You can now use the web app to install/update remote_display.py automatically."
