"""Local Caddy integration: no Docker, system services, or external traffic."""

import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Backend(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.path.encode())

    do_POST = do_GET

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@unittest.skipUnless(shutil.which("caddy"), "Caddy is required for proxy integration tests")
class MaintenanceProxyTest(unittest.TestCase):
    def test_protected_console_through_caddy_survives_updater_restart(self):
        # Short paths also exercise the real public Unix socket on macOS.
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory)
            marker = root / "maintenance"
            marker.mkdir()
            (marker / "active").touch()
            private = root / "private" / "updater.sock"
            public = root / "public" / "updater.sock"
            port, hv_port = free_port(), free_port()
            source = Path(__file__).parent
            config = root / "Caddyfile"
            config.write_text("{\n admin off\n auto_https off\n}\n" + source.joinpath("Caddyfile").read_text()
                              .replace("{$APP_HOST}", f"http://127.0.0.1:{port}")
                              .replace("{$HAPPYVIEW_HOST}", f"http://127.0.0.1:{hv_port}")
                              .replace("/srv/atmobb-maintenance", str(marker))
                              .replace("unix//run/atmobb-updater-public/updater.sock", f"unix/{public}"))
            env = {**os.environ, "ATMOBB_UPDATER_TOKEN": "local-fixture",
                   "ATMOBB_UPDATER_SOCKET": str(private), "ATMOBB_UPDATER_PUBLIC_SOCKET": str(public),
                   "ATMOBB_UPDATER_SOCKET_GID": str(os.getgid()), "ATMOBB_UPDATER_STATE_DIR": str(root / "state"),
                   "ATMOBB_MAINTENANCE_DIR": str(marker), "ATMOBB_BUNDLE_DIR": str(root),
                   "XDG_DATA_HOME": str(root), "XDG_CONFIG_HOME": str(root)}
            with (root / "process.log").open("w+") as log:
                updater = subprocess.Popen(["python3", str(source / "updater.py")], env=env, stdout=log, stderr=log)
                caddy = subprocess.Popen(["caddy", "run", "--config", str(config), "--adapter", "caddyfile"],
                                         env=env, stdout=log, stderr=log)
                try:
                    for _ in range(100):
                        try:
                            if self.request(port, "/_atmobb/status")[0] == 401:
                                break
                        except OSError:
                            pass
                        time.sleep(0.02)
                    else:
                        log.seek(0)
                        self.fail(log.read())
                    connection = http.client.HTTPConnection("localhost")
                    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    connection.sock.connect(str(private))
                    connection.request("POST", "/session", headers={"Authorization": "Bearer local-fixture"})
                    response = connection.getresponse()
                    token = json.loads(response.read())["token"]
                    connection.close()
                    cookie = {"Cookie": f"atmobb_updater={token}"}
                    self.assertEqual(self.request(port)[0], 503)
                    self.assertEqual(self.request(port, "/_atmobb/")[0], 200)
                    status, headers, body = self.request(port, "/_atmobb/status", headers=cookie)
                    self.assertEqual(status, 200)
                    self.assertTrue(json.loads(body)["maintenance"])
                    self.assertEqual(headers["Cache-Control"], "no-store")
                    self.assertEqual(self.request(port, "/_atmobb/session", "POST", cookie)[0], 404)
                    self.assertEqual(self.request(port, "/_atmobb/maintenance/off", "POST", cookie)[0], 403)
                    updater.terminate()
                    updater.wait(timeout=5)
                    self.assertEqual(self.request(port)[0], 503)
                    updater = subprocess.Popen(["python3", str(source / "updater.py")], env=env, stdout=log, stderr=log)
                    for _ in range(100):
                        if self.request(port, "/_atmobb/status", headers=cookie)[0] == 200:
                            break
                        time.sleep(0.02)
                    else:
                        self.fail("Operator session did not survive updater restart")
                    self.assertEqual(self.request(port)[0], 503)
                finally:
                    updater.terminate()
                    updater.wait(timeout=5)
                    caddy.terminate()
                    caddy.wait(timeout=5)

    def test_gate_survives_stopped_app_and_isolates_instances(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backend = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
            threading.Thread(target=backend.serve_forever, daemon=True).start()
            upstream = f"127.0.0.1:{backend.server_port}"
            ports = [free_port() for _ in range(4)]
            template = Path(__file__).with_name("Caddyfile").read_text()
            sites = []
            for index in range(2):
                marker = root / f"tenant-{index}"
                marker.mkdir()
                sites.append(template.replace("{$APP_HOST}", f"http://127.0.0.1:{ports[index * 2]}")
                             .replace("{$HAPPYVIEW_HOST}", f"http://127.0.0.1:{ports[index * 2 + 1]}")
                             .replace("/srv/atmobb-maintenance", str(marker))
                             .replace("atmobb:3001", upstream).replace("happyview:3000", upstream)
                             .replace("unix//run/atmobb-updater-public/updater.sock", upstream))
            config = root / "Caddyfile"
            config.write_text("{\n admin off\n auto_https off\n}\n" + "\n".join(sites))
            with (root / "caddy.log").open("w+") as log:
                process = subprocess.Popen(["caddy", "run", "--config", str(config), "--adapter", "caddyfile"],
                                           stdout=log, stderr=log,
                                           env={**os.environ, "XDG_DATA_HOME": str(root), "XDG_CONFIG_HOME": str(root)})
                try:
                    for _ in range(100):
                        try:
                            self.assertEqual(self.request(ports[0])[0], 200)
                            break
                        except OSError:
                            time.sleep(0.02)
                    else:
                        log.seek(0)
                        self.fail(log.read())
                    (root / "tenant-0" / "active").touch()
                    for port in ports[:2]:
                        for method in ("GET", "POST"):
                            status, headers, body = self.request(port, method=method)
                            self.assertEqual(status, 503)
                            self.assertEqual(headers["Retry-After"], "60")
                            self.assertEqual(headers["Cache-Control"], "no-store")
                            self.assertEqual(headers["X-Atmobb-Maintenance"], "1")
                            self.assertIn(b"maintenance", body)
                    self.assertEqual(self.request(ports[1], "/admin/config")[0], 404)
                    self.assertEqual(self.request(ports[0], "/_atmobb/status")[2], b"/status")
                    self.assertEqual(self.request(ports[2])[0], 200)
                    self.assertEqual(self.request(ports[3])[0], 200)
                    backend.shutdown()
                    backend.server_close()
                    self.assertEqual(self.request(ports[0])[0], 503)
                    self.assertEqual(self.request(ports[1], method="POST")[0], 503)
                    self.assertEqual(self.request(ports[2])[0], 502)
                finally:
                    process.terminate()
                    process.wait(timeout=5)
                    backend.shutdown()
                    backend.server_close()

    @staticmethod
    def request(port, path="/", method="GET", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()
