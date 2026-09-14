import http.client
import json
import os
import socket
import subprocess
import tempfile
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
        })
        self.process = subprocess.Popen(["python3", "infra/release/updater.py"], env=env)
        for _ in range(100):
            if self.socket.exists():
                break
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
        self.assertEqual(started["status"], "running")
        self.assertEqual(self.request("POST", "/update/main")[0], 409)

        for _ in range(100):
            _, finished = self.request("GET", "/status")
            if finished["status"] != "running":
                break
            time.sleep(0.02)
        self.assertEqual(finished["status"], "succeeded")
        self.assertEqual(finished["installedVersion"], "2.0.0")
        self.assertEqual(finished["backup"], "/backup/one")
        self.assertEqual(finished["candidateCommit"], "0123456789abcdef0123456789abcdef01234567")
        self.assertIn("preparing-stable", finished["log"])
        self.assertTrue((self.state / "state.json").exists())


if __name__ == "__main__":
    unittest.main()
