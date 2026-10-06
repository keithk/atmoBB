import http.client
import fcntl
import json
import os
import shutil
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


class UpgradeOrderingTest(unittest.TestCase):
    def run_upgrade(self, managed, fail_setup=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binaries = root / "bin"
            binaries.mkdir()
            data = root / "oauth"
            data.mkdir()
            (root / ".env").write_text(
                f"ATMOBB_DATA_DIR={data}\nATMOBB_UPDATER_TOKEN=fixture\n")
            release = Path(__file__).resolve().parent
            shutil.copy(release / "compose.yml", root / "compose.yml")
            source = root / "source"
            (source / "infra").mkdir(parents=True)
            shutil.copytree(release, source / "infra" / "release")
            (source / "docs").mkdir()
            (source / "docs" / "self-hosting.md").write_text("fixture")
            (source / "LICENSE").write_text("fixture")
            (source / "package.json").write_text('{"version":"0.5.0"}')
            (source / "Dockerfile").write_text("ARG HAPPYVIEW_VERSION=2.16.0\n")
            with tarfile.open(root / "archive.tar.gz", "w:gz") as archive:
                archive.add(source, arcname="source")
            (binaries / "docker").write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
with (root / 'docker.log').open('a') as log: log.write(' '.join(args) + '\\n')
if args == ['compose', 'version', '--short']: print('2.39.4')
elif args[:1] == ['inspect']:
    if 'ExitCode' in args[2]: print('1' if os.environ['FAIL_SETUP'] == '1' else '0')
    elif args[-1] == 'happyview-id':
        print('ghcr.io/gamesgamesgamesgamesgames/happyview:' + ('2.16.0' if (root / 'migrated').exists() else '2.14.0'))
    else: print('atmobb-main:' + '0' * 40 if os.environ['MANAGED'] == '1' else 'ghcr.io/keithk/atmobb:0.5.0')
elif args[:1] == ['compose']:
    if 'config' in args:
        print(json.dumps({'services': {'happyview': {'image': 'ghcr.io/gamesgamesgamesgamesgames/happyview:2.16.0'},
          'atmobb': {'image': 'atmobb-main:' + '0' * 40 if os.environ['MANAGED'] == '1' else 'ghcr.io/keithk/atmobb:0.5.0'}}}))
    elif 'ps' in args and '-q' in args: print(args[-1] + '-id')
    elif 'up' in args and 'happyview' in args: (root / 'migrated').touch()
""")
            (binaries / "curl").write_text("""#!/usr/bin/env python3
import json, os, pathlib, shutil, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
if '-o' in args:
    out = pathlib.Path(args[args.index('-o') + 1])
    if out.name == 'commit.json': out.write_text(json.dumps({'sha': '0' * 40}))
    else: shutil.copy(root / 'archive.tar.gz', out)
else: print('{"version":"0.5.0","happyview":"2.16.0"}')
""")
            (binaries / "sudo").write_text('#!/bin/sh\nexec "$@"\n')
            (binaries / "chown").write_text('#!/bin/sh\nexit 0\n')
            (binaries / "stat").write_text(f'#!/bin/sh\necho "{os.getuid()}:{os.getgid()}"\n')
            for binary in binaries.iterdir():
                binary.chmod(0o755)
            env = {**os.environ, "PATH": f"{binaries}:{os.environ['PATH']}",
                   "FIXTURE_ROOT": str(root), "MANAGED": str(int(managed)),
                   "FAIL_SETUP": str(int(fail_setup)), "ATMOBB_BUNDLE_DIR": str(root),
                   "ATMOBB_UPDATER_STATE_DIR": str(root / "state"),
                   "ATMOBB_UPDATER_LIB_DIR": str(root / "lib"),
                   "ATMOBB_UPDATER_INTERNAL": "fixture"}
            command = ["_update", "main"] if managed else ["upgrade-happyview", "--yes"]
            result = subprocess.run(["sh", str(release / "atmobb"), *command],
                                    env=env, capture_output=True, text=True)
            return result, (root / "docker.log").read_text().splitlines()

    def test_prepare_stop_backup_migrate_setup_then_start(self):
        for managed in (False, True):
            with self.subTest(managed=managed):
                result, calls = self.run_upgrade(managed)
                self.assertEqual(result.returncode, 0, result.stderr)
                def position(fragment):
                    return next(i for i, call in enumerate(calls) if fragment in call)
                self.assertLess(position("pull"), position("stop atmobb"))
                self.assertLess(position("stop atmobb"), position("pg_dump"))
                migration = "up -d postgres happyview" if managed else "up -d --no-deps happyview"
                self.assertLess(position("pg_dump"), position(migration))
                self.assertLess(position(migration), position("up --no-deps --force-recreate setup"))
                self.assertLess(position("up --no-deps --force-recreate setup"), position("inspect --format {{.State.ExitCode}}"))
                start = "up -d --remove-orphans" if managed else "compose --project-name atmobb up -d"
                self.assertGreater(max(i for i, call in enumerate(calls) if call == start or call.endswith(start)),
                                   position("inspect --format {{.State.ExitCode}}"))
                self.assertIn("backup complete:" if managed else "backup written to", result.stdout)
                if managed:
                    self.assertIn("ATMOBB_BACKUP=", result.stdout)

    def test_failed_setup_leaves_app_stopped(self):
        for managed in (False, True):
            with self.subTest(managed=managed):
                result, calls = self.run_upgrade(managed, fail_setup=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("setup container did not finish successfully", result.stderr)
                self.assertTrue(any("stop atmobb" in call for call in calls))
                self.assertFalse(any(call.endswith("up -d --remove-orphans") or
                                     call == "compose --project-name atmobb up -d" for call in calls))


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
