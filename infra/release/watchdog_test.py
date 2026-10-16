"""Host watchdog checks over a fixture Docker executable, never a real daemon."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("watchdog", Path(__file__).with_name("watchdog.py"))
watchdog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watchdog)


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.fixture = self.root / "docker.json"
        self.calls = self.root / "calls.jsonl"
        binary = self.root / "docker"
        binary.write_text(f"#!{sys.executable}\n" + r'''
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["WATCHDOG_CALLS"], "a") as log:
    log.write(json.dumps(args) + "\n")
fixture = json.loads(Path(os.environ["WATCHDOG_FIXTURE"]).read_text())
if args[0] == "ps":
    assert "label=com.docker.compose.project=atmobb-fixture" in args
    service = "happyview" if "label=com.docker.compose.service=happyview" in args else "postgres"
    print(fixture.get(service, service + "-id"))
elif args[0] == "inspect":
    print(json.dumps({"Running": fixture.get("running", True), "StartedAt": fixture["started"]}))
elif args[0] == "exec":
    assert args[1] == "postgres-id"
    assert "BEGIN READ ONLY" in args[-1] and "statement_timeout" in args[-1]
    if fixture.get("query_error"):
        sys.stderr.write("fixture secret that must not reach diagnostics")
        sys.exit(1)
    if fixture.get("stop_during_query"):
        fixture["running"] = False
        Path(os.environ["WATCHDOG_FIXTURE"]).write_text(json.dumps(fixture))
    print(fixture["cursor"])
elif args[0] == "restart":
    assert args == ["restart", "--timeout", "20", "happyview-id"]
    if fixture.get("restart_error"):
        sys.stderr.write("fixture secret that must not reach diagnostics")
        sys.exit(1)
else:
    raise AssertionError(args)
''')
        binary.chmod(0o755)
        env = mock.patch.dict(os.environ, {
            "PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}",
            "WATCHDOG_FIXTURE": str(self.fixture),
            "WATCHDOG_CALLS": str(self.calls),
        })
        env.start()
        self.addCleanup(env.stop)
        self.config = {
            "project": "atmobb-fixture",
            "state_dir": str(self.root / "state"),
            "maintenance_dir": str(self.root / "maintenance"),
            "updater_state_dir": str(self.root / "updater"),
            "host_lock": str(self.root / "host.lock"),
        }
        self.sample = {"cursor": 1_000_000_000, "started": "1970-01-01T00:00:01Z"}
        self.fixture.write_text(json.dumps(self.sample))

    def check(self, now, **sample):
        self.sample.update(sample)
        self.fixture.write_text(json.dumps(self.sample))
        return watchdog.check(self.config, now=now)

    def stalled(self):
        self.check(1000)
        for now in (1060, 1120, 1180, 1240):
            self.assertNotEqual(self.check(now)["status"], "recovering")
        return self.check(1300)

    def restarts(self):
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        return [call for call in calls if call[0] == "restart"]

    def test_restarts_only_happyview_after_five_minutes_without_cursor_progress(self):
        self.assertEqual(self.stalled()["status"], "recovering")
        self.assertEqual(self.restarts(), [["restart", "--timeout", "20", "happyview-id"]])

    def test_persistent_stall_never_restarts_again_even_after_cooldown_or_process_restart(self):
        self.stalled()
        for now in range(1360, 3100, 60):
            result = self.check(now)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(len(self.restarts()), 1)

    def test_active_replay_does_not_restart_even_with_an_old_cursor(self):
        for step in range(20):
            result = self.check(1000 + step * 60, cursor=1_000_000_000 + step)
        self.assertEqual(result["status"], "catching_up")
        self.assertEqual(self.restarts(), [])

    def test_live_progress_rearms_but_cooldown_still_blocks_a_second_restart(self):
        self.stalled()
        result = self.check(1360, cursor=1_360_000_000)
        self.assertFalse(result["recovery_pending"])
        for now in range(1420, 2200, 60):
            result = self.check(now)
        self.assertEqual(result["status"], "cooldown")
        self.assertEqual(len(self.restarts()), 1)
        self.assertEqual(self.check(2260)["status"], "recovering")
        self.assertEqual(len(self.restarts()), 2)

    def test_replay_progress_alone_does_not_rearm_a_failed_recovery(self):
        self.stalled()
        self.check(1360, cursor=1_000_000_001)
        for now in range(1420, 3100, 60):
            result = self.check(now)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(len(self.restarts()), 1)

    def test_startup_grace_and_discontinuous_checks_start_a_new_observation_window(self):
        self.check(1000, started="1970-01-01T00:16:30Z")
        for now in range(1060, 1300, 60):
            self.assertEqual(self.check(now)["status"], "grace")
        self.check(2000)
        self.assertEqual(self.restarts(), [])
        self.assertEqual(self.check(1900)["status"], "observing")

    def test_maintenance_and_both_update_locks_suppress_restarts(self):
        import fcntl
        self.config["maintenance_dir"] = str(self.root / "maintenance")
        marker = Path(self.config["maintenance_dir"]) / "active"
        marker.parent.mkdir()
        marker.touch()
        self.assertEqual(self.check(1000)["status"], "paused")
        self.assertFalse(self.calls.exists())
        marker.unlink()
        for lock_path in (Path(self.config["host_lock"]), Path(self.config["updater_state_dir"]) / "maintenance.lock"):
            lock_path.parent.mkdir(exist_ok=True)
            with lock_path.open("a+") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertEqual(self.check(1060)["status"], "paused")
        self.assertEqual(self.restarts(), [])

    def test_stopped_container_missing_cursor_and_query_failure_never_restart(self):
        for sample in ({"running": False}, {"cursor": ""}, {"cursor": "not-a-cursor"}, {"query_error": True}):
            self.sample = {"cursor": 1_000_000_000, "started": "1970-01-01T00:00:01Z"}
            result = self.check(1000, **sample)
            self.assertIn(result["status"], ("paused", "error"))
            self.assertNotIn("fixture secret", json.dumps(result))
        self.assertEqual(self.restarts(), [])

    def test_failed_restart_consumes_the_attempt_and_never_exposes_command_output(self):
        self.sample["restart_error"] = True
        result = self.stalled()
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("fixture secret", json.dumps(result))
        for now in range(1360, 3100, 60):
            self.check(now)
        self.assertEqual(len(self.restarts()), 1)

    def test_budget_is_persisted_before_restart_is_attempted(self):
        real_run = watchdog.run
        def run(args, **kwargs):
            if args[0:2] == ["docker", "restart"]:
                state = json.loads((Path(self.config["state_dir"]) / "state.json").read_text())
                self.assertTrue(state["recovery_pending"])
                self.assertEqual(state["last_restart_at"], 1300)
            return real_run(args, **kwargs)
        with mock.patch.object(watchdog, "run", side_effect=run):
            self.stalled()

    def test_operator_stop_during_probe_cancels_the_restart(self):
        self.check(1000)
        for now in (1060, 1120, 1180, 1240):
            self.check(now)
        self.assertEqual(self.check(1300, stop_during_query=True)["status"], "failed")
        self.assertEqual(self.restarts(), [])

    def test_probe_failure_and_maintenance_do_not_reset_a_consumed_restart_budget(self):
        self.stalled()
        self.check(1360, query_error=True)
        self.check(1420, query_error=False)
        marker = Path(self.config["maintenance_dir"]) / "active"
        marker.parent.mkdir()
        marker.touch()
        self.check(1480)
        marker.unlink()
        for now in range(1540, 3100, 60):
            result = self.check(now)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(len(self.restarts()), 1)

    def test_manual_reset_rearms_without_erasing_the_cooldown(self):
        self.stalled()
        config_file = self.root / "config.json"
        config_file.write_text(json.dumps(self.config))
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("watchdog.py")), "--config", str(config_file), "reset"],
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(result.stdout)
        self.assertFalse(state["recovery_pending"])
        self.assertEqual(state["last_restart_at"], 1300)
        self.assertNotIn("sample", state)
        self.assertEqual(len(self.restarts()), 1)

    def test_future_cursor_and_ambiguous_container_fail_without_restart(self):
        self.assertEqual(self.check(1000, cursor=2_000_000_000)["status"], "error")
        self.assertEqual(self.check(1000, happyview="one-id\ntwo-id")["status"], "error")
        self.assertEqual(self.restarts(), [])

    def test_corrupt_state_fails_closed_and_status_is_read_only(self):
        self.check(1000)
        state_file = Path(self.config["state_dir"]) / "state.json"
        state_file.write_text('{"recovery_pending": "invalid"}')
        with self.assertRaises(watchdog.WatchdogError):
            self.check(1060)
        self.assertEqual(self.restarts(), [])
        self.assertEqual(state_file.read_text(), '{"recovery_pending": "invalid"}')

    def test_cli_status_does_not_contact_docker(self):
        config_file = self.root / "config.json"
        config_file.write_text(json.dumps(self.config))
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("watchdog.py")), "--config", str(config_file), "status"],
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "uninitialized")
        self.assertFalse(self.calls.exists())

    def test_cli_probe_failure_exits_nonzero_with_sanitized_diagnostics(self):
        self.sample["query_error"] = True
        self.fixture.write_text(json.dumps(self.sample))
        config_file = self.root / "config.json"
        config_file.write_text(json.dumps(self.config))
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("watchdog.py")), "--config", str(config_file), "check"],
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["status"], "error")
        self.assertNotIn("fixture secret", result.stdout + result.stderr)
        self.assertEqual(self.restarts(), [])


if __name__ == "__main__":
    unittest.main()
