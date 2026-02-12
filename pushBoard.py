#!/usr/bin/env python3
"""
Push a board mode to the running Lyda Board server.

Examples:
  python3 pushBoard.py widgets
  python3 pushBoard.py message --host 192.168.1.50 --port 3000
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from urllib import request, error


def build_auth_header(username: str, password: str) -> dict[str, str]:
    token = f"{username}:{password}".encode("utf-8")
    encoded = base64.b64encode(token).decode("ascii")
    return {"Authorization": f"Basic {encoded}"}


def http_json(method: str, url: str, payload: dict | None, headers: dict[str, str]) -> dict:
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers = {**headers, "Content-Type": "application/json"}

    req = request.Request(url, data=body, headers=headers, method=method)
    with request.urlopen(req, timeout=15) as response:
        data = response.read().decode("utf-8")
        return json.loads(data)


def normalize_mode(value: str) -> str:
    raw = (value or "").strip().lower()
    aliases = {
        "widget": "widgets",
        "widgets": "widgets",
        "message": "message",
        "animation": "animation",
        "valentine": "valentine",
        "pixel": "pixels",
        "pixels": "pixels",
    }
    if raw not in aliases:
        raise ValueError(f"Unknown mode: {value}")
    return aliases[raw]


def main() -> int:
    parser = argparse.ArgumentParser(description="Push a mode to the Lyda Board server.")
    parser.add_argument("mode", help="Mode to push: widgets, message, animation, valentine, pixels")
    parser.add_argument("--host", default=os.getenv("LOVE_BOARD_HOST", "127.0.0.1"))
    parser.add_argument("--port", default=os.getenv("LOVE_BOARD_PORT", "3000"))
    parser.add_argument("--user", default=os.getenv("BASIC_AUTH_USER", ""))
    parser.add_argument("--password", default=os.getenv("BASIC_AUTH_PASS", ""))

    args = parser.parse_args()
    mode = normalize_mode(args.mode)

    base_url = f"http://{args.host}:{args.port}"
    headers: dict[str, str] = {}
    if args.user and args.password:
        headers.update(build_auth_header(args.user, args.password))

    try:
        state = http_json("GET", f"{base_url}/api/state", None, headers)
        payload = {
            "mode": mode,
            "state": state,
        }
        result = http_json("POST", f"{base_url}/api/board/push", payload, headers)
    except error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        print(f"HTTP error: {err.code} {err.reason}\n{detail}".strip(), file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"Error: {err}", file=sys.stderr)
        return 1

    print(f"Mode pushed: {result.get('mode', mode)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
