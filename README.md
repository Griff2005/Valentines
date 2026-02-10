# Love Board Remote (64x32 RGB Matrix)

A simple, intuitive website for remotely controlling a **64x32 LED matrix** connected to a Raspberry Pi 4 using:

- [`hzeller/rpi-rgb-led-matrix`](https://github.com/hzeller/rpi-rgb-led-matrix)
- Pi host: `lrdigiboard`
- Pi user: `lydarose`

## Features

- Widget dashboard mode:
  - Weather widget (city + unit selection + icon)
  - Calendar day widget (manual events + ICS day import from `schedule.2026WI.ics`)
  - To-do widget (easy task add/remove + bullet style selection)
  - Rotating daily note widget (from a note catalog)
- Full-board message mode:
  - Custom text
  - Color + speed + effect (scroll/pulse/static)
- Animation mode:
  - Rainbow Wave, Heart Beat, Sparkles, Color Wipe
- Pixel Painter mode:
  - 64x32 draw canvas
  - Eraser, clear, fill
- Pi controls:
  - Test SSH connection
  - Install/update renderer script on Pi
  - Start/stop display renderer

## Project Structure

- `server.js`: Express API + static file hosting
- `public/`: UI (`index.html`, `styles.css`, `app.js`)
- `services/`: backend modules (state store, weather, payload builder, Pi SSH client)
- `pi/remote_display.py`: renderer script run on Raspberry Pi
- `pi/install_pi_side.sh`: optional helper to install Python bindings on Pi
- `pi/setup_web_service.sh`: installs and enables always-on `systemd` web service on Pi
- `pi/update_web_service.sh`: pulls latest Git changes, reinstalls deps, restarts service
- `pi/love-board.env.example`: environment settings template for production
- `data/defaultState.js`: default app state

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm start
```

3. Open:

```text
http://localhost:3000
```

## Always-On Hosting on Raspberry Pi

This is the setup to keep the website running all the time on your Pi, including after reboots.

1. Copy this project to the Pi (for example at `~/Valentines`).
2. From the Pi terminal, run:

```bash
cd ~/Valentines
bash pi/setup_web_service.sh
```

This script installs required packages, ensures Node.js 18+ (auto-upgrades if needed), and enables `love-board` at boot.

3. Confirm service health:

```bash
sudo systemctl status love-board
sudo journalctl -u love-board -f
```

4. Open from phone on same Wi-Fi:

```text
http://<PI_IP>:3000
```

You can also try:

```text
http://lrdigiboard.local:3000
```

### Updating After New Git Commits

After you push new commits and want the Pi to update:

```bash
cd ~/Valentines
bash pi/update_web_service.sh
```

Or, to update a specific branch:

```bash
bash pi/update_web_service.sh main
```

## Raspberry Pi Matrix Setup

### 1) Install matrix Python bindings on the Pi

From your Pi terminal:

```bash
bash ~/path/to/Valentines/pi/install_pi_side.sh
```

or manually follow setup in the `rpi-rgb-led-matrix` repository.

### 2) In the web app, fill Pi settings

- Host: `lrdigiboard`
- Port: `22`
- Username: `lydarose`
- Password: your Pi password
- Remote script path: `/home/lydarose/remote_display.py`
- Python command: `python3`

### 3) Click **Install Pi Script**

This uploads `pi/remote_display.py` to the Pi and makes it executable.

### 4) Click **Show Current Tab on Board**

The web app sends your selected mode and content to the Pi and starts rendering.

## Access From Phone At Any Time

- Same Wi-Fi (local access): use `http://<PI_IP>:3000`.
- Away from home (remote access), recommended with Tailscale:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
```

Install the Tailscale app on the phone, sign in to the same Tailnet, then open `http://<TAILSCALE_IP>:3000`.
- If you expose this site publicly, set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in `/etc/love-board.env` and restart:

```bash
sudo systemctl restart love-board
```

## Notes

- Settings are persisted in `data/state.json`.
- If you store a password in the UI, it is saved in `data/state.json` for convenience.
- Renderer logs on Pi: `/tmp/lrdigiboard.log`

## Troubleshooting

- Error: `Pi renderer failed to start` when clicking **Show Current Tab on Board**:
  - Click **Install Pi Script** first.
  - If the error includes log lines about `rgbmatrix` import or permissions, run `pi/install_pi_side.sh` on the Pi.
  - If it mentions GPIO permission issues, enable **Run renderer with sudo** in the UI and try again.
- Service does not start on boot:
  - Run `sudo systemctl enable --now love-board`.
  - Check logs with `sudo journalctl -u love-board -n 100 --no-pager`.

## API Endpoints

- `GET /api/state`
- `PUT /api/state`
- `POST /api/weather`
- `GET /api/calendar/day?date=YYYY-MM-DD`
- `POST /api/pi/test`
- `POST /api/pi/install`
- `POST /api/board/push`
- `POST /api/board/stop`

## Quick Use Flow

1. Configure Pi connection.
2. Click **Test Connection**.
3. Click **Install Pi Script**.
4. Choose a tab (Widgets, Full Message, Animation, Pixel Painter).
5. Click **Show Current Tab on Board**.
