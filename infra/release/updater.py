#!/usr/bin/env python3
"""Authenticated, fixed-action host updater for an atmobb Compose stack."""

import hmac
import hashlib
import fcntl
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import UnixStreamServer
from urllib.parse import urlsplit

BUNDLE = Path(os.environ.get("ATMOBB_BUNDLE_DIR", "/srv/atmobb"))
MAINTENANCE_DIR = Path(os.environ.get("ATMOBB_MAINTENANCE_DIR", "/var/lib/atmobb-maintenance"))
STATE_DIR = Path(os.environ.get("ATMOBB_UPDATER_STATE_DIR", "/var/lib/atmobb-updater"))
STATE_FILE = STATE_DIR / "state.json"
RESULT_FILE = STATE_DIR / "result.json"
SOCKET = Path(os.environ.get("ATMOBB_UPDATER_SOCKET", "/run/atmobb-updater/updater.sock"))
PUBLIC_SOCKET = Path(os.environ.get("ATMOBB_UPDATER_PUBLIC_SOCKET", str(SOCKET.parent) + "-public/updater.sock"))
TOKEN = os.environ["ATMOBB_UPDATER_TOKEN"]
APP_HOST = os.environ.get("APP_HOST", "")
SESSION_SECONDS = 43200
SOCKET_GID = int(os.environ.get("ATMOBB_UPDATER_SOCKET_GID", "10001"))
WORKER = os.environ.get("ATMOBB_UPDATER_WORKER", "/usr/local/lib/atmobb/atmobb")
HOST_LOCK = Path(os.environ.get("ATMOBB_HOST_UPDATE_LOCK", "/var/lock/atmobb-hosting.lock"))
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


def run_update(target: str, action: str = "update") -> None:
    global worker
    state = read_state()
    log: list[str] = []
    env = os.environ.copy()
    env["ATMOBB_UPDATER_INTERNAL"] = TOKEN
    try:
        HOST_LOCK.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        with HOST_LOCK.open("a+") as host_lock:
            with state_lock:
                state.update({"status": "waiting", "message": "Waiting for another hosted instance update to finish."})
                write_state(state)
            fcntl.flock(host_lock, fcntl.LOCK_EX)
            with state_lock:
                state.update({"status": "running", "message": f"{action.capitalize()} is running."})
                write_state(state)
            process = subprocess.Popen(
                [WORKER, "_update" if action == "update" else "maintenance", target], cwd=BUNDLE, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            assert process.stdout is not None
            for raw in process.stdout:
                line = raw.rstrip()
                if action == "update" and line.startswith("ATMOBB_TARGET_VERSION="):
                    state["candidateVersion"] = line.partition("=")[2]
                elif action == "update" and line.startswith("ATMOBB_TARGET_COMMIT="):
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
                raise RuntimeError(f"{action.capitalize()} command exited with status {code}.")
        # Recovery can finish a target whose original update failed. Only consume
        # a result written by this job; an already-open no-op has no new result.
        result = json.loads(RESULT_FILE.read_text()) if (
            action == "update" or (target in ("off", "recover") and RESULT_FILE.exists())
        ) else {}
        with state_lock:
            state.update(result)
            message = "Update completed and health checks passed." if action == "update" else (
                "Maintenance enabled." if target == "on" else "Recovery completed and health checks passed."
            )
            state.update({"status": "succeeded", "finishedAt": now(), "message": message, "log": log})
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
        self.send_body(status, body, "application/json")

    def send_body(self, status: int, body: bytes, content_type: str, csp: str | None = None) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header("referrer-policy", "no-referrer")
        self.send_header("cross-origin-resource-policy", "same-origin")
        self.send_header("content-security-policy", csp or "default-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if not self.authenticated():
            self.reply(401, {"error": "Unauthorized."})
        elif self.path != "/status":
            self.reply(404, {"error": "Not found."})
        else:
            with state_lock:
                self.reply(200, {**read_state(), "maintenance": (MAINTENANCE_DIR / "active").exists()})

    def do_POST(self) -> None:
        global worker
        if not self.authenticated():
            self.reply(401, {"error": "Unauthorized."})
            return
        if self.path == "/session":
            expiry = int(time.time()) + SESSION_SECONDS
            payload = f"v1.{expiry}"
            signature = hmac.new(TOKEN.encode(), payload.encode(), hashlib.sha256).hexdigest()
            self.reply(200, {"token": f"{payload}.{signature}", "expiresAt": datetime.fromtimestamp(expiry, timezone.utc).isoformat()})
            return
        routes = {
            **{f"/update/{target}": ("update", target) for target in ("stable", "main")},
            **{f"/maintenance/{target}": ("maintenance", target) for target in ("on", "off", "recover")},
        }
        if self.path not in routes:
            self.reply(404, {"error": "Unsupported action."})
            return
        action, target = routes[self.path]
        with state_lock:
            if worker is not None:
                self.reply(409, {"error": "An operation is already running."})
                return
            previous = read_state()
            state = {
                "status": "waiting",
                "action": action,
                "target": target,
                "startedAt": now(),
                "installedVersion": previous.get("installedVersion") or initial_version(),
                "installedCommit": previous.get("installedCommit"),
                "candidateVersion": None,
                "candidateCommit": None,
                "backup": previous.get("backup"),
                "log": [],
            }
            write_state(state)
            RESULT_FILE.unlink(missing_ok=True)
            worker = threading.Thread(target=run_update, args=(target, action), daemon=True)
            worker.start()
        self.reply(202, state)

    def log_message(self, format: str, *args: object) -> None:
        pass


class UnixHTTPServer(UnixStreamServer, HTTPServer):
    address_family = __import__("socket").AF_UNIX


def normalized_origin(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            return None
        host = parsed.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        return f"https://{host}" + (f":{parsed.port}" if parsed.port not in (None, 443) else "")
    except ValueError:
        return None


class PublicHandler(Handler):
    def authenticated(self) -> bool:
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie["atmobb_updater"].value
            version, expires, signature = token.split(".")
            if version != "v1" or not expires.isascii() or not expires.isdecimal():
                return False
            expiry = int(expires)
            if not time.time() < expiry <= time.time() + SESSION_SECONDS:
                return False
            expected = hmac.new(TOKEN.encode(), f"{version}.{expires}".encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(signature.encode(), expected.encode())
        except (CookieError, KeyError, ValueError):
            return False

    def do_GET(self) -> None:
        if self.path == "/":
            body = Path(__file__).with_name("updater-page.html").read_bytes()
            # Hash only the shipped inline assets: no unsafe-inline or external resources.
            import base64
            scripts = re.findall(rb"<script>(.*?)</script>", body, re.S)
            styles = re.findall(rb"<style>(.*?)</style>", body, re.S)
            def hashes(parts):
                return " ".join("'sha256-" + base64.b64encode(hashlib.sha256(part).digest()).decode() + "'" for part in parts)
            self.send_body(200, body, "text/html; charset=utf-8",
                           f"default-src 'none'; script-src {hashes(scripts)}; style-src {hashes(styles)}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        else:
            super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/session":
            self.reply(404, {"error": "Not found."})
            return
        if not self.authenticated():
            self.reply(401, {"error": "Unauthorized."})
            return
        expected = normalized_origin(APP_HOST if APP_HOST.startswith("https://") else f"https://{APP_HOST or self.headers.get('Host', '')}")
        origin = normalized_origin(self.headers.get("Origin", ""))
        if self.headers.get("X-Atmobb-Operator") != "1" or not expected or origin != expected:
            self.reply(403, {"error": "Same-origin operator request required."})
            return
        super().do_POST()


def main() -> None:
    global worker
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    state = read_state()
    if state.get("status") in ("waiting", "running"):
        state.update({"status": "failed", "finishedAt": now(), "message": "The updater stopped before the operation finished."})
        write_state(state)
    SOCKET.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(SOCKET.parent, os.geteuid(), SOCKET_GID)
    os.chmod(SOCKET.parent, 0o750)
    SOCKET.unlink(missing_ok=True)
    server = UnixHTTPServer(str(SOCKET), Handler)
    os.chown(SOCKET, os.geteuid(), SOCKET_GID)
    os.chmod(SOCKET, 0o660)
    if PUBLIC_SOCKET.parent.resolve() == SOCKET.parent.resolve():
        raise ValueError("The public socket requires a separate directory.")
    PUBLIC_SOCKET.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chmod(PUBLIC_SOCKET.parent, 0o755)
    PUBLIC_SOCKET.unlink(missing_ok=True)
    public = UnixHTTPServer(str(PUBLIC_SOCKET), PublicHandler)
    os.chmod(PUBLIC_SOCKET, 0o666)
    threading.Thread(target=public.serve_forever, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        public.shutdown()
        public.server_close()
        PUBLIC_SOCKET.unlink(missing_ok=True)
        server.server_close()
        SOCKET.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
