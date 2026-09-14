#!/usr/bin/env python3
"""Authenticated, fixed-action host updater for an atmobb Compose stack."""

import hmac
import json
import os
import re
import subprocess
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import UnixStreamServer

BUNDLE = Path(os.environ.get("ATMOBB_BUNDLE_DIR", "/srv/atmobb"))
STATE_DIR = Path(os.environ.get("ATMOBB_UPDATER_STATE_DIR", "/var/lib/atmobb-updater"))
STATE_FILE = STATE_DIR / "state.json"
RESULT_FILE = STATE_DIR / "result.json"
SOCKET = Path(os.environ.get("ATMOBB_UPDATER_SOCKET", "/run/atmobb-updater/updater.sock"))
TOKEN = os.environ["ATMOBB_UPDATER_TOKEN"]
SOCKET_GID = int(os.environ.get("ATMOBB_UPDATER_SOCKET_GID", "10001"))
WORKER = os.environ.get("ATMOBB_UPDATER_WORKER", "/usr/local/lib/atmobb/atmobb")
state_lock = threading.Lock()
worker: threading.Thread | None = None


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def initial_version() -> str | None:
    try:
        match = re.search(r"ghcr\.io/keithk/atmobb:([^\s]+)", (BUNDLE / "compose.yml").read_text())
        return match.group(1) if match else None
    except OSError:
        return None


def read_state() -> dict:
    try:
        value = json.loads(STATE_FILE.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {"status": "idle", "installedVersion": initial_version()}


def write_state(value: dict) -> None:
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, STATE_FILE)


def run_update(target: str) -> None:
    global worker
    state = read_state()
    log: list[str] = []
    env = os.environ.copy()
    env["ATMOBB_UPDATER_INTERNAL"] = TOKEN
    try:
        process = subprocess.Popen(
            [WORKER, "_update", target],
            cwd=BUNDLE,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        assert process.stdout is not None
        for raw in process.stdout:
            line = raw.rstrip()
            if line.startswith("ATMOBB_TARGET_VERSION="):
                state["candidateVersion"] = line.partition("=")[2]
            elif line.startswith("ATMOBB_TARGET_COMMIT="):
                state["candidateCommit"] = line.partition("=")[2] or None
            elif line.startswith("ATMOBB_BACKUP="):
                state["backup"] = line.partition("=")[2]
            log.append(line)
            log = log[-120:]
            with state_lock:
                state.update({"status": "running", "log": log})
                write_state(state)
        code = process.wait()
        if code:
            raise RuntimeError(f"Update command exited with status {code}.")
        result = json.loads(RESULT_FILE.read_text())
        with state_lock:
            state.update(result)
            state.update({"status": "succeeded", "finishedAt": now(), "message": "Update completed and health checks passed.", "log": log})
            write_state(state)
    except Exception as error:
        with state_lock:
            state.update({
                "status": "failed",
                "finishedAt": now(),
                "message": str(error),
                "log": log,
            })
            write_state(state)
    finally:
        with state_lock:
            worker = None


class Handler(BaseHTTPRequestHandler):
    def authenticated(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, f"Bearer {TOKEN}")

    def reply(self, status: int, value: dict) -> None:
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if not self.authenticated():
            self.reply(401, {"error": "Unauthorized."})
        elif self.path != "/status":
            self.reply(404, {"error": "Not found."})
        else:
            with state_lock:
                self.reply(200, read_state())

    def do_POST(self) -> None:
        global worker
        if not self.authenticated():
            self.reply(401, {"error": "Unauthorized."})
            return
        target = self.path.removeprefix("/update/")
        if target not in ("stable", "main") or self.path != f"/update/{target}":
            self.reply(404, {"error": "Only stable and main updates are supported."})
            return
        with state_lock:
            if worker is not None:
                self.reply(409, {"error": "An update is already running."})
                return
            previous = read_state()
            state = {
                "status": "running",
                "target": target,
                "startedAt": now(),
                "installedVersion": previous.get("installedVersion") or initial_version(),
                "installedCommit": previous.get("installedCommit"),
                "candidateVersion": None,
                "candidateCommit": None,
                "backup": None,
                "log": [],
            }
            write_state(state)
            RESULT_FILE.unlink(missing_ok=True)
            worker = threading.Thread(target=run_update, args=(target,), daemon=True)
            worker.start()
        self.reply(202, state)

    def log_message(self, format: str, *args: object) -> None:
        pass


class UnixHTTPServer(UnixStreamServer, HTTPServer):
    address_family = __import__("socket").AF_UNIX


def main() -> None:
    global worker
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    state = read_state()
    if state.get("status") == "running":
        state.update({"status": "failed", "finishedAt": now(), "message": "The updater stopped before the operation finished."})
        write_state(state)
    SOCKET.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(SOCKET.parent, os.geteuid(), SOCKET_GID)
    os.chmod(SOCKET.parent, 0o750)
    SOCKET.unlink(missing_ok=True)
    server = UnixHTTPServer(str(SOCKET), Handler)
    os.chown(SOCKET, os.geteuid(), SOCKET_GID)
    os.chmod(SOCKET, 0o660)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        SOCKET.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
