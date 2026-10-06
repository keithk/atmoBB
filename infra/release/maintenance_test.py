"""Fixture-driven operator tests. Never contacts Docker, systemd or the network."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tarfile
import unittest


SCRIPT = Path(__file__).with_name("atmobb")


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls"
        self.state = self.root / "private"
        self.data = self.root / "oauth"
        self.data.mkdir()
        (self.data / "session").write_text("keep private session")
        shutil.copy(SCRIPT, self.bundle / "atmobb")
        (self.bundle / ".env").write_text(
            f"APP_HOST=forum.example\nHAPPYVIEW_HOST=hv.example\n"
            f"ATMOBB_DATA_DIR={self.data}\nATMOBB_UPDATER_TOKEN=secret\n"
        )
        (self.bundle / "compose.yml").write_text("# ATMOBB_MAINTENANCE_VERSION=1\n")
        (self.bundle / "Caddyfile").write_text("operator customized proxy")
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        ATMOBB_BUNDLE_DIR=str(self.bundle),
                        ATMOBB_UPDATER_STATE_DIR=str(self.state),
                        ATMOBB_UPDATER_LIB_DIR=str(self.root / "lib"),
                        ATMOBB_MAINTENANCE_DIR=str(self.root / "public"),
                        ATMOBB_HOST_UPDATE_LOCK=str(self.root / "host.lock"),
                        FIXTURE_LOG=str(self.log))
        self.stub("id", "print('0')\n")
        self.stub("sudo", "raise SystemExit('unexpected sudo in fixture')\n")
        self.stub("systemctl", "raise SystemExit('unexpected service command in fixture')\n")
        self.stub("docker", r'''
import json, os, sys
a=sys.argv[1:]
with open(os.environ["FIXTURE_LOG"], "a") as f: f.write("docker "+" ".join(a)+"\n")
if a == ["info"]: pass
elif a[:2] == ["compose", "version"]: print("2.30.0")
elif a[0] == "inspect":
    fmt=a[a.index("--format")+1]
    if "ExitCode" in fmt: print(os.environ.get("SETUP_EXIT_CODE", "0"))
    elif "Config.Image" in fmt:
        images = os.path.join(os.environ["ATMOBB_UPDATER_STATE_DIR"],"maintenance-target","images.json")
        print(json.load(open(images))["services"][a[-1]]["image"] if os.path.exists(images) else "fixture:"+a[-1])
    elif ".Image" in fmt:
        if os.environ.get("WRONG_IMAGE") == a[-1]:
            print("sha256:wrong"); sys.exit(0)
        images = os.path.join(os.environ["ATMOBB_UPDATER_STATE_DIR"],"maintenance-target","images.json")
        if os.path.exists(images):
            print(json.load(open(images))["services"][a[-1]]["image"])
        else: print("sha256:"+a[-1])
    else: print("sha256:"+a[-1].split(":")[-1])
elif a[:2] == ["image", "inspect"]: print("sha256:"+a[-1].split(":")[-1])
elif a[0] == "run": print('{"version":"1.2.3","happyview":"2.14.0"}')
elif a[0] == "build":
    if os.environ.get("FAIL_PREP"): sys.exit(1)
elif a[0] == "compose":
    if "config" in a: print(json.dumps({"services":{s:{"image":"fixture:"+s} for s in ["atmobb","happyview","setup","postgres"]}}))
    elif "pull" in a:
        if os.environ.get("FAIL_PREP"): sys.exit(1)
    elif "ps" in a: print(a[-1])
    elif "exec" in a: print("database backup contents")
    elif "up" in a and a[-1] == "setup" and os.environ.get("FAIL_SETUP"): sys.exit(1)
else: raise Exception(a)
''')
        self.stub("curl", r'''
import os, sys, shutil
a=sys.argv[1:]
with open(os.environ["FIXTURE_LOG"], "a") as f: f.write("curl "+" ".join(a)+"\n")
url=next((x for x in a if x.startswith(("https://","http://"))),"")
if "-o" in a:
    from pathlib import Path
    fixtures=Path(os.environ["DOWNLOADS"])
    shutil.copy(fixtures / url.rsplit("/",1)[-1], a[a.index("-o")+1])
elif url.startswith("https://"):
    if "--dump-header" in a:
        header="" if os.environ.get("MISSING_HEADER") else "X-Atmobb-Maintenance: 1\r\n"
        open(a[a.index("--dump-header")+1],"w").write("HTTP/2 503\r\n"+header+"\r\n")
    print("200" if os.environ.get("FAIL_GATE") else "503",end="")
elif "/config" in url: print('{"version":"2.14.0"}')
else:
    import json
    print(json.dumps({"version":os.environ.get("WRONG_VERSION","1.2.3"),"happyview":"2.14.0"}))
''')

    def stub(self, name, text):
        p = self.bin / name
        p.write_text("#!/usr/bin/env python3\n" + text)
        p.chmod(0o755)

    def run_cli(self, *args, ok=True, **env):
        p = subprocess.run(["sh", str(self.bundle / "atmobb"), *args],
                           env=self.env | env, capture_output=True, text=True, timeout=20)
        self.assertEqual(p.returncode == 0, ok, p.stdout + p.stderr)
        return p

    @property
    def marker(self):
        return self.root / "public" / "active"

    def test_manual_on_off_and_permissions(self):
        self.run_cli("maintenance", "on")
        self.assertTrue(self.marker.exists())
        self.assertEqual(self.marker.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.marker.parent.stat().st_mode & 0o777, 0o755)
        calls = self.log.read_text()
        self.assertLess(calls.index("https://hv.example/"), calls.index("stop"))
        self.assertIn("stop --timeout 60 atmobb happyview", calls)
        self.run_cli("maintenance", "off")
        self.assertFalse(self.marker.exists())
        self.assertNotIn("remove-orphans", self.log.read_text())

    def test_proxy_gate_failure_never_stops(self):
        self.run_cli("maintenance", "on", ok=False, FAIL_GATE="1")
        self.assertTrue(self.marker.exists())
        self.assertNotIn(" stop ", self.log.read_text())

    def test_503_without_proof_header_is_rejected(self):
        self.run_cli("maintenance", "on", ok=False, MISSING_HEADER="1")
        self.assertTrue(self.marker.exists())
        self.assertNotIn(" stop ", self.log.read_text())

    def test_preparation_failure_preserves_prior_state(self):
        self.run_cli("upgrade", ok=False, FAIL_PREP="1")
        self.assertFalse(self.marker.exists())
        self.assertFalse((self.bundle / "backups").exists())
        self.run_cli("maintenance", "on")
        self.run_cli("upgrade", ok=False, FAIL_PREP="1")
        self.assertTrue(self.marker.exists())

    def test_post_migration_failure_restart_recovery_and_backup(self):
        failed = self.run_cli("upgrade-happyview", "--yes", ok=False, FAIL_SETUP="1")
        self.assertTrue(self.marker.exists())
        dumps = list((self.bundle / "backups").glob("*/postgres.dump"))
        self.assertEqual(len(dumps), 1)
        self.assertIn(f"ATMOBB_BACKUP={dumps[0].parent}", failed.stdout)
        before = dumps[0].read_bytes()
        self.run_cli("maintenance", "recover")
        self.assertFalse(self.marker.exists())
        self.assertEqual(dumps[0].read_bytes(), before)
        self.assertEqual((self.bundle / "Caddyfile").read_text(), "operator customized proxy")
        self.assertEqual((dumps[0].parent / "env").read_bytes(), (self.bundle / ".env").read_bytes())
        with tarfile.open(dumps[0].parent / "oauth.tar.gz") as archive:
            self.assertEqual(archive.extractfile("oauth/session").read(), b"keep private session")

    def test_upgrade_success_and_ordering(self):
        self.run_cli("upgrade")
        self.assertFalse(self.marker.exists())
        calls = self.log.read_text()
        self.assertLess(calls.index(" pull"), calls.index("https://forum.example/"))
        self.assertLess(calls.index("stop --timeout"), calls.index("pg_dump"))
        self.assertLess(calls.index("pg_dump"), calls.index(" up "))
        self.assertNotIn("remove-orphans", calls)
        self.assertNotIn("up -d caddy", calls)

    def test_upgrade_accepts_same_happyview_after_digest_based_recovery(self):
        self.run_cli("maintenance", "on")
        self.run_cli("maintenance", "off")
        self.run_cli("upgrade")
        self.assertFalse(self.marker.exists())

    def test_failed_setup_container_never_starts_app(self):
        self.run_cli("upgrade", ok=False, SETUP_EXIT_CODE="1")
        self.assertTrue(self.marker.exists())
        self.assertNotIn(" up -d --no-deps atmobb", self.log.read_text())

    def test_health_and_image_mismatch_keep_marker(self):
        self.run_cli("upgrade", ok=False, WRONG_VERSION="old")
        target = (self.state / "maintenance-target" / "target.json").read_bytes()
        self.run_cli("maintenance", "off", ok=False, WRONG_IMAGE="happyview")
        self.assertTrue(self.marker.exists())
        self.assertEqual((self.state / "maintenance-target" / "target.json").read_bytes(), target)
        self.run_cli("maintenance", "recover")
        self.assertFalse(self.marker.exists())

    def test_marker_without_target_cannot_open(self):
        self.marker.parent.mkdir()
        self.marker.touch()
        self.run_cli("maintenance", "off", ok=False)
        self.assertTrue(self.marker.exists())

    def test_busy_instance_lock(self):
        import fcntl
        self.state.mkdir()
        with (self.state / "maintenance.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.run_cli("maintenance", "on", ok=False)
        self.assertFalse(self.marker.exists())

    def test_status_without_root_docker_or_private_state(self):
        self.stub("id", "print('1000')\n")
        self.stub("docker", "raise SystemExit('Docker unavailable')\n")
        self.assertEqual(json.loads(self.run_cli("maintenance", "status").stdout), {"active": False})
        self.assertFalse(self.state.exists())
        self.marker.parent.mkdir()
        self.marker.touch()
        self.assertEqual(json.loads(self.run_cli("maintenance", "status").stdout), {"active": True})

    def test_mutating_command_requires_root_before_any_changes(self):
        self.stub("id", "print('1000')\n")
        p = self.run_cli("upgrade", ok=False)
        self.assertIn("rerun: sudo", p.stderr)
        self.assertFalse(self.state.exists())
        self.assertFalse(self.log.exists())

    def stable_fixture(self, old=False):
        candidate = self.root / "candidate"
        shutil.copytree(self.bundle, candidate)
        compose = "# ATMOBB_INSTANCE_CONFIG_VERSION=1\n"
        if not old:
            compose += "# ATMOBB_MAINTENANCE_VERSION=1\n"
        (candidate / "compose.yml").write_text(compose)
        for name in ("updater.py", "updater-page.html"):
            (candidate / name).write_text("fixture")
        downloads = self.root / "downloads"
        downloads.mkdir()
        asset = "atmobb-1.2.3.tar.gz"
        with tarfile.open(downloads / asset, "w:gz") as archive:
            archive.add(candidate, arcname="bundle")
        digest = hashlib.sha256((downloads / asset).read_bytes()).hexdigest()
        (downloads / "SHA256SUMS").write_text(f"{digest}  {asset}\n")
        (downloads / "latest").write_text(json.dumps({
            "tag_name": "v1.2.3",
            "assets": [{"name": name, "browser_download_url": f"https://fixtures/{name}"}
                       for name in (asset, "SHA256SUMS")]}))
        self.env.update(DOWNLOADS=str(downloads), ATMOBB_UPDATER_INTERNAL="secret",
                        ATMOBB_UPDATE_RELEASE_API="https://fixtures/latest")

    def test_internal_update_does_not_reacquire_host_lock(self):
        import fcntl
        self.stable_fixture()
        with (self.root / "host.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.run_cli("upgrade", ok=False)
            self.run_cli("_update", "stable")
        self.assertFalse(self.marker.exists())
        self.assertEqual((self.root / "lib" / "updater-page.html").read_text(), "fixture")
        self.assertEqual((self.bundle / "Caddyfile").read_text(), "operator customized proxy")

    def test_internal_stable_failure_recovers_durable_target(self):
        self.stable_fixture()
        self.run_cli("_update", "stable", ok=False, FAIL_SETUP="1")
        self.assertTrue(self.marker.exists())
        self.assertEqual(list(self.state.glob("work.*")), [])
        # Recovery must not re-download or require the disposable stage.
        shutil.rmtree(self.root / "downloads")
        self.run_cli("maintenance", "recover")
        result = json.loads((self.state / "result.json").read_text())
        self.assertEqual(result["installedVersion"], "1.2.3")
        self.assertTrue(Path(result["backup"]).is_dir())
        self.assertFalse(self.marker.exists())

    def main_fixture(self):
        self.stable_fixture()
        source = self.root / "source"
        (source / "infra").mkdir(parents=True)
        shutil.copytree(self.root / "candidate", source / "infra" / "release")
        for name in ("compose.caddy.yml", "compose.hosting.yml", "env.example"):
            (source / "infra" / "release" / name).write_text("fixture")
        (source / "docs").mkdir()
        (source / "docs" / "self-hosting.md").write_text("fixture")
        (source / "LICENSE").write_text("fixture")
        (source / "Dockerfile").write_text("ARG HAPPYVIEW_VERSION=2.14.0\n")
        (source / "package.json").write_text('{"version":"1.2.3"}')
        sha = "a" * 40
        downloads = self.root / "downloads"
        with tarfile.open(downloads / f"{sha}.tar.gz", "w:gz") as archive:
            archive.add(source, arcname="source")
        (downloads / "main").write_text(json.dumps({"sha": sha}))
        self.env.update(ATMOBB_UPDATE_MAIN_API="https://fixtures/main",
                        ATMOBB_UPDATE_ARCHIVE_BASE="https://fixtures")
        return sha

    def test_main_build_preparation_failure_leaves_live_service(self):
        self.main_fixture()
        self.run_cli("_update", "main", ok=False, FAIL_PREP="1")
        self.assertFalse(self.marker.exists())
        self.assertNotIn("pg_dump", self.log.read_text())
        self.assertNotIn(" stop ", self.log.read_text())

    def test_main_packaging_and_commit_survive_recovery(self):
        sha = self.main_fixture()
        self.run_cli("_update", "main", ok=False, FAIL_SETUP="1")
        self.assertTrue(self.marker.exists())
        self.run_cli("maintenance", "recover")
        result = json.loads((self.state / "result.json").read_text())
        self.assertEqual(result["installedCommit"], sha)
        self.assertEqual((self.root / "lib" / "updater-page.html").read_text(), "fixture")
        self.run_cli("maintenance", "on")
        self.run_cli("maintenance", "off")
        self.assertEqual(json.loads((self.state / "result.json").read_text())["installedCommit"], sha)

    def test_old_candidate_refused_before_activation(self):
        self.stable_fixture(old=True)
        self.run_cli("_update", "stable", ok=False)
        self.assertFalse(self.marker.exists())
        calls = self.log.read_text()
        self.assertNotIn(" stop ", calls)
        self.assertNotIn("pg_dump", calls)

    def test_instance_isolation_with_other_instance_busy(self):
        import fcntl
        other_state = self.root / "other-state"
        other_state.mkdir()
        other_marker = self.root / "other-public" / "active"
        other_marker.parent.mkdir()
        other_marker.touch()
        with (other_state / "maintenance.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.run_cli("maintenance", "on")
            self.run_cli("maintenance", "off")
        self.assertTrue(other_marker.exists())


if __name__ == "__main__":
    unittest.main()
