import http.client
import hashlib
import hmac
import fcntl
import json
import os
import socket
import subprocess
import tempfile
import tarfile
import time
import unittest
from pathlib import Path


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str):
        super().__init__("localhost")
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.path)


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        # macOS's default temporary directory can exceed sockaddr_un's limit.
        self.temp = tempfile.TemporaryDirectory(dir="/tmp")
        root = Path(self.temp.name)
        self.bundle = root / "bundle"
        self.state = root / "state"
        self.socket = root / "run" / "updater.sock"
        self.public_socket = root / "run-public" / "updater.sock"
        self.maintenance = root / "maintenance"
        self.host_lock = root / "hosting.lock"
        self.bundle.mkdir()
        (self.bundle / "compose.yml").write_text("image: ghcr.io/keithk/atmobb:1.2.3\n")
        command = self.bundle / "atmobb"
        command.write_text("""#!/bin/sh
set -eu
test "$ATMOBB_UPDATER_INTERNAL" = test-token
echo "$*" >> "$ATMOBB_BUNDLE_DIR/commands"
if [ "$1" = maintenance ]; then
  sleep 0.25
  mkdir -p "$ATMOBB_MAINTENANCE_DIR"
  if [ "$2" = on ]; then touch "$ATMOBB_MAINTENANCE_DIR/active"; else rm -f "$ATMOBB_MAINTENANCE_DIR/active"; fi
  if [ "$2" = recover ] && [ -f "$ATMOBB_BUNDLE_DIR/recovery-result.json" ]; then
    cp "$ATMOBB_BUNDLE_DIR/recovery-result.json" "$ATMOBB_UPDATER_STATE_DIR/result.json"
  fi
  exit 0
fi
echo preparing-$2
echo ATMOBB_TARGET_VERSION=2.0.0
echo ATMOBB_TARGET_COMMIT=0123456789abcdef0123456789abcdef01234567
echo ATMOBB_BACKUP=/backup/one
sleep 0.25
printf '{"installedVersion":"2.0.0","installedCommit":null,"backup":"/backup/one"}' > "$ATMOBB_UPDATER_STATE_DIR/result.json"
""")
        command.chmod(0o755)
        env = os.environ.copy()
        env.update({
            "ATMOBB_BUNDLE_DIR": str(self.bundle),
            "ATMOBB_UPDATER_STATE_DIR": str(self.state),
            "ATMOBB_UPDATER_SOCKET": str(self.socket),
            "ATMOBB_UPDATER_TOKEN": "test-token",
            "ATMOBB_UPDATER_SOCKET_GID": str(os.getgid()),
            "ATMOBB_UPDATER_WORKER": str(command),
            "ATMOBB_HOST_UPDATE_LOCK": str(self.host_lock),
            "ATMOBB_MAINTENANCE_DIR": str(self.maintenance),
            "APP_HOST": "forum.example",
        })
        self.env = env
        self.start()

    def start(self):
        self.process = subprocess.Popen(["python3", "infra/release/updater.py"], env=self.env)
        for _ in range(300):
            if self.socket.exists() and self.public_socket.exists():
                probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                try:
                    probe.connect(str(self.public_socket))
                    break
                except ConnectionRefusedError:
                    pass
                finally:
                    probe.close()
            time.sleep(0.02)
        else:
            self.fail("updater socket was not created")

    def tearDown(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.temp.cleanup()

    def test_recovery_publishes_only_its_fresh_verified_target(self):
        recovered = {"installedVersion": "2.1.0", "installedCommit": "a" * 40, "backup": "/backup/recovered"}
        (self.bundle / "recovery-result.json").write_text(json.dumps(recovered))
        self.assertEqual(self.request("POST", "/maintenance/recover")[0], 202)
        for _ in range(100):
            _, state = self.request("GET", "/status")
            if state["status"] not in ("waiting", "running"):
                break
            time.sleep(0.02)
        self.assertEqual(state["status"], "succeeded")
        for key, value in recovered.items():
            self.assertEqual(state[key], value)

    def request(self, method: str, path: str, token: str = "test-token"):
        connection = UnixConnection(str(self.socket))
        connection.request(method, path, headers={"Authorization": f"Bearer {token}"})
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response.status, body

    def public_request(self, method, path, headers=None):
        connection = UnixConnection(str(self.public_socket))
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        raw = response.read()
        body = json.loads(raw) if response.getheader("content-type") == "application/json" else raw.decode()
        self.assertEqual(response.getheader("cache-control"), "no-store")
        self.assertEqual(response.getheader("x-content-type-options"), "nosniff")
        self.assertIsNone(response.getheader("access-control-allow-origin"))
        self.assertNotIn("unsafe-inline", response.getheader("content-security-policy"))
        connection.close()
        return response.status, body

    def session_headers(self):
        _, session = self.request("POST", "/session")
        return {"Cookie": f"atmobb_updater={session['token']}", "Origin": "https://forum.example",
                "X-Atmobb-Operator": "1"}

    def finished(self):
        for _ in range(300):
            _, state = self.request("GET", "/status")
            if state["status"] not in ("waiting", "running"):
                return state
            time.sleep(.02)
        self.fail("operation did not finish")

    def test_public_cookie_scope_expiry_and_csrf(self):
        status, page = self.public_request("GET", "/")
        self.assertEqual(status, 200)
        self.assertNotIn("test-token", page)
        self.assertNotIn("innerHTML", page)
        self.assertEqual(self.public_request("GET", "/status")[0], 401)
        self.assertEqual(self.public_request("GET", "/status", {"Authorization": "Bearer test-token"})[0], 401)
        headers = self.session_headers()
        self.assertEqual(self.public_request("GET", "/status", headers)[0], 200)
        self.assertEqual(self.public_request("POST", "/session", headers)[0], 404)
        self.assertEqual(self.request("POST", "/session", headers["Cookie"].split("=", 1)[1])[0], 401)
        for secret, expiry in (("other-tenant-token", int(time.time()) + 300), ("test-token", int(time.time()) - 1)):
            payload = f"v1.{expiry}"
            token = payload + "." + hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
            self.assertEqual(self.public_request("GET", "/status", {"Cookie": f"atmobb_updater={token}"})[0], 401)
        for token in ("wrong", "v1.no.bad", f"v1.{int(time.time()) + 300}.é"):
            self.assertEqual(self.public_request("GET", "/status", {"Cookie": f"atmobb_updater={token}"})[0], 401)
        for bad in ({k: v for k, v in headers.items() if k != "Origin"},
                    {**headers, "Origin": "https://evil.example"},
                    {**headers, "Origin": "http://forum.example"},
                    {**headers, "X-Atmobb-Operator": "0"}):
            self.assertEqual(self.public_request("POST", "/maintenance/on", bad)[0], 403)
        self.assertEqual(self.public_request("POST", "/maintenance/on", {**headers, "Origin": "https://FORUM.example:443"})[0], 202)
        self.assertEqual(self.request("POST", "/update/stable")[0], 409)
        self.assertEqual(self.finished()["status"], "succeeded")
        self.assertEqual(self.public_socket.stat().st_mode & 0o777, 0o666)
        self.assertEqual(self.public_socket.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.socket.stat().st_mode & 0o777, 0o660)

    def test_maintenance_dispatch_marker_and_stale_result(self):
        self.state.mkdir(exist_ok=True)
        (self.state / "result.json").write_text('{"installedVersion":"stale"}')
        for action in ("on", "off", "recover"):
            self.assertEqual(self.request("POST", f"/maintenance/{action}")[0], 202)
            result = self.finished()
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(result["action"], "maintenance")
            self.assertEqual(result["installedVersion"], "1.2.3")
            self.assertEqual(result["maintenance"], action == "on")
        self.assertEqual((self.bundle / "commands").read_text().splitlines(),
                         ["maintenance on", "maintenance off", "maintenance recover"])

    def test_failed_state_and_marker_survive_restart(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.maintenance.mkdir()
        (self.maintenance / "active").touch()
        self.state.mkdir(exist_ok=True)
        persisted = {"status": "failed", "message": "setup failed", "backup": "/backup/safe", "log": ["failure"]}
        (self.state / "state.json").write_text(json.dumps(persisted))
        self.start()
        _, state = self.request("GET", "/status")
        self.assertEqual(state, {**persisted, "maintenance": True})

    def test_interrupted_state_retains_maintenance_and_backup(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.maintenance.mkdir()
        (self.maintenance / "active").touch()
        self.state.mkdir(exist_ok=True)
        (self.state / "state.json").write_text(json.dumps({
            "status": "running", "action": "update", "backup": "/backup/last", "log": ["setup started"],
        }))
        self.start()
        _, state = self.request("GET", "/status")
        self.assertEqual(state["status"], "failed")
        self.assertTrue(state["maintenance"])
        self.assertEqual(state["backup"], "/backup/last")
        self.assertEqual(state["log"], ["setup started"])

    def test_maintenance_uses_shared_host_lock(self):
        with self.host_lock.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.public_request("POST", "/maintenance/on", self.session_headers())[0], 202)
            time.sleep(.05)
            self.assertEqual(self.request("GET", "/status")[1]["status"], "waiting")
            self.assertFalse((self.bundle / "commands").exists())
            self.assertEqual(self.request("POST", "/update/main")[0], 409)
        self.assertTrue(self.finished()["maintenance"])

    def test_origin_fallback_uses_host_and_https(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.env["APP_HOST"] = ""
        self.start()
        headers = {**self.session_headers(), "Host": "Forum.Example:443"}
        self.assertEqual(self.public_request("POST", "/maintenance/on", {**headers, "Origin": "http://forum.example"})[0], 403)
        self.assertEqual(self.public_request("POST", "/maintenance/on", headers)[0], 202)
        self.finished()

    def test_authentication_actions_serialization_and_persisted_result(self):
        self.assertEqual(self.request("GET", "/status", "wrong")[0], 401)
        self.assertEqual(self.request("POST", "/update/other")[0], 404)

        status, started = self.request("POST", "/update/stable")
        self.assertEqual(status, 202)
        self.assertEqual(started["status"], "waiting")
        self.assertEqual(self.request("POST", "/update/main")[0], 409)

        for _ in range(100):
            _, finished = self.request("GET", "/status")
            if finished["status"] not in ("waiting", "running"):
                break
            time.sleep(0.02)
        self.assertEqual(finished["status"], "succeeded")
        self.assertEqual(finished["installedVersion"], "2.0.0")
        self.assertEqual(finished["backup"], "/backup/one")
        self.assertEqual(finished["candidateCommit"], "0123456789abcdef0123456789abcdef01234567")
        self.assertIn("preparing-stable", finished["log"])
        self.assertTrue((self.state / "state.json").exists())

    def test_private_session_mint(self):
        status, session = self.request("POST", "/session")
        self.assertEqual(status, 200)
        self.assertIn("token", session)
        self.assertIn("expiresAt", session)

    def test_waits_on_host_lock_without_losing_instance_status(self):
        with self.host_lock.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.request("POST", "/update/main")[0], 202)
            time.sleep(0.05)
            _, waiting = self.request("GET", "/status")
            self.assertEqual(waiting["status"], "waiting")
            self.assertEqual(waiting["target"], "main")
            self.assertIn("another hosted instance", waiting["message"])
        for _ in range(100):
            _, finished = self.request("GET", "/status")
            if finished["status"] not in ("waiting", "running"):
                break
            time.sleep(0.02)
        self.assertEqual(finished["status"], "succeeded")


class InstanceConfigTest(unittest.TestCase):
    def test_worker_uses_persisted_project_port_and_rejects_old_candidates_before_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binaries = root / 'bin'
            binaries.mkdir()
            # Exercise the root-owned worker contract without elevating the test.
            (binaries / 'id').write_text('#!/bin/sh\necho 0\n')
            (root / '.env').write_text('ATMOBB_INSTANCE_ID=tenant-z\nATMOBB_APP_PORT=12721\nATMOBB_HAPPYVIEW_PORT=12720\nATMOBB_UPDATER_TOKEN=fixture\n')
            (root / 'compose.yml').write_text('original instance config\n')
            old = root / 'source' / 'infra' / 'release'
            old.mkdir(parents=True)
            # Maintenance support alone must not bypass the instance-isolation gate.
            (old / 'compose.yml').write_text('# ATMOBB_MAINTENANCE_VERSION=1\nold single-instance config\n')
            (old / 'atmobb').write_text('#!/bin/sh\n# ATMOBB_MAINTENANCE_VERSION=1\n')
            with tarfile.open(root / 'archive.tar.gz', 'w:gz') as archive:
                archive.add(root / 'source', arcname='source')
            (binaries / 'docker').write_text('''#!/bin/sh
echo "$*" >> "$FIXTURE_ROOT/docker.log"
case "$*" in 'compose version --short') echo 2.39.4 ;; esac
''')
            (binaries / 'curl').write_text('''#!/bin/sh
echo "$*" >> "$FIXTURE_ROOT/curl.log"
out=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then out=$2; shift; fi
  shift
done
case "$out" in
  */commit.json) printf '{"sha":"0123456789abcdef0123456789abcdef01234567"}' > "$out" ;;
  */main.tar.gz) cp "$FIXTURE_ROOT/archive.tar.gz" "$out" ;;
  '') printf '{"version":"0.2.1","happyview":"2.14.0"}' ;;
esac
''')
            for executable in binaries.iterdir():
                executable.chmod(0o755)
            env = {**os.environ, 'PATH': f'{binaries}:{os.environ["PATH"]}', 'FIXTURE_ROOT': str(root),
                   'ATMOBB_BUNDLE_DIR': str(root), 'ATMOBB_UPDATER_STATE_DIR': str(root / 'state'),
                   'ATMOBB_UPDATER_INTERNAL': 'fixture'}
            worker = str(Path(__file__).with_name('atmobb').resolve())
            subprocess.run(['sh', worker, 'status'], env=env, check=True, capture_output=True)
            self.assertIn('compose --project-name atmobb-tenant-z ps', (root / 'docker.log').read_text())
            self.assertIn('http://127.0.0.1:12721/api/version', (root / 'curl.log').read_text())
            result = subprocess.run(['sh', worker, '_update', 'main'], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('does not support isolated instance configuration', result.stderr)
            self.assertNotIn('build ', (root / 'docker.log').read_text())
            self.assertNotIn('pull', (root / 'docker.log').read_text())
            self.assertEqual((root / 'compose.yml').read_text(), 'original instance config\n')
            self.assertFalse((root / 'backups').exists())


if __name__ == "__main__":
    unittest.main()
