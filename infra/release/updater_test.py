import http.client
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
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.bundle = root / "bundle"
        self.state = root / "state"
        self.socket = root / "run" / "updater.sock"
        self.host_lock = root / "hosting.lock"
        self.bundle.mkdir()
        (self.bundle / "compose.yml").write_text("image: ghcr.io/keithk/atmobb:1.2.3\n")
        command = self.bundle / "atmobb"
        command.write_text("""#!/bin/sh
set -eu
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
        })
        self.process = subprocess.Popen(["python3", "infra/release/updater.py"], env=env)
        for _ in range(100):
            if self.socket.exists():
                probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                try:
                    probe.connect(str(self.socket))
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

    def request(self, method: str, path: str, token: str = "test-token"):
        connection = UnixConnection(str(self.socket))
        connection.request(method, path, headers={"Authorization": f"Bearer {token}"})
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response.status, body

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
            (root / '.env').write_text('ATMOBB_INSTANCE_ID=tenant-z\nATMOBB_APP_PORT=12721\nATMOBB_HAPPYVIEW_PORT=12720\nATMOBB_UPDATER_TOKEN=fixture\n')
            (root / 'compose.yml').write_text('original instance config\n')
            old = root / 'source' / 'infra' / 'release'
            old.mkdir(parents=True)
            (old / 'compose.yml').write_text('old single-instance config\n')
            (old / 'atmobb').write_text('#!/bin/sh\n')
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
