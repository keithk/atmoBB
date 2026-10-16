#!/usr/bin/env python3
"""One bounded, host-only ingestion check. No PDS writes or container recreation."""
import argparse
from contextlib import ExitStack
from datetime import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


GRACE_SECONDS = 300
STALL_SECONDS = 300
MIN_MISSES = 3
COOLDOWN_SECONDS = 900
MAX_CHECK_GAP = 120
CONFIG_KEYS = {"project", "state_dir", "maintenance_dir", "updater_state_dir", "host_lock"}


class WatchdogError(Exception):
    """Safe diagnostic: never contains command output, configuration or credentials."""


def validate_config(config):
    if not isinstance(config, dict) or set(config) != CONFIG_KEYS:
        raise WatchdogError("Watchdog configuration has missing or unknown fields.")
    if not isinstance(config["project"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", config["project"]):
        raise WatchdogError("Invalid Compose project.")
    for key in CONFIG_KEYS - {"project"}:
        if not isinstance(config[key], str) or not Path(config[key]).is_absolute():
            raise WatchdogError("Watchdog paths must be absolute.")


def run(args, timeout=10):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        # Even Docker/psql errors can include connection strings. Surface only
        # the fixed operation name, never stdout/stderr or the exception text.
        raise WatchdogError(f"{args[0]} {args[1]} failed or timed out.") from None


def read_state(directory):
    try:
        state = json.loads((directory / "state.json").read_text())
    except FileNotFoundError:
        return {"version": 1, "status": "uninitialized", "recovery_pending": False, "last_restart_at": None}
    except (OSError, ValueError):
        raise WatchdogError("Cannot read watchdog state; inspect it before resetting the restart budget.") from None
    try:
        if not isinstance(state, dict) or state["version"] != 1:
            raise ValueError()
        if type(state["recovery_pending"]) is not bool or not isinstance(state["status"], str):
            raise ValueError()
        if "last_restart_at" not in state or (state["recovery_pending"] and state["last_restart_at"] is None):
            raise ValueError()
        for key in ("checked_at", "progress_at", "last_restart_at"):
            value = state.get(key)
            if value is not None and not (type(value) in (int, float) and math.isfinite(value) and value >= 0):
                raise ValueError()
        if type(state.get("misses", 0)) is not int or state.get("misses", 0) < 0:
            raise ValueError()
        if "sample" in state:
            sample = state["sample"]
            if not isinstance(sample["container"], str) or type(sample["cursor"]) is not int or sample["cursor"] <= 0:
                raise ValueError()
            if type(sample["started"]) not in (int, float) or not math.isfinite(sample["started"]):
                raise ValueError()
            if state.get("checked_at") is None or state.get("progress_at") is None or "misses" not in state:
                raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise WatchdogError("Invalid watchdog state; inspect it before resetting the restart budget.") from None
    return state


def write_state(directory, state):
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as output:
        temporary = Path(output.name)
        try:
            json.dump(state, output)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, directory / "state.json")
            fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            temporary.unlink(missing_ok=True)


def lock(stack, path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle = stack.enter_context(path.open("a+"))
    os.chmod(path, 0o600)
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)


def container(project, service):
    ids = run([
        "docker", "ps", "--all",
        "--filter", f"label=com.docker.compose.project={project}",
        "--filter", f"label=com.docker.compose.service={service}",
        "--format", "{{.ID}}",
    ]).split()
    if len(ids) != 1 or not re.fullmatch(r"[a-zA-Z0-9-]+", ids[0]):
        raise WatchdogError(f"Expected exactly one {service} container; no restart attempted.")
    return ids[0]


def running_since(happyview):
    try:
        state = json.loads(run(["docker", "inspect", "--format", "{{json .State}}", happyview]))
        if not state["Running"] or state.get("Paused") or state.get("Restarting"):
            return None
        return datetime.fromisoformat(state["StartedAt"].replace("Z", "+00:00")).timestamp()
    except (ValueError, KeyError, TypeError):
        raise WatchdogError("Cannot inspect HappyView startup state; no restart attempted.") from None


def sample_cursor(config):
    happyview = container(config["project"], "happyview")
    started = running_since(happyview)
    if started is None:
        return None
    postgres = container(config["project"], "postgres")
    cursor = run([
        "docker", "exec", postgres, "psql", "-X", "-qAt",
        "-U", "happyview", "-d", "happyview", "-v", "ON_ERROR_STOP=1", "-c",
        "BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; "
        "SELECT value FROM happyview_instance_settings WHERE key = 'jetstream_cursor'; COMMIT;",
    ])
    if not re.fullmatch(r"[0-9]{1,19}", cursor) or int(cursor) <= 0:
        raise WatchdogError("Jetstream cursor is missing or invalid; no restart attempted.")
    return {"container": happyview, "started": started, "cursor": int(cursor)}


def pause(state, now, status, message):
    # A maintenance window, failed probe or interrupted timer is not evidence
    # of an ingestion stall. Retain the restart budget, discard observations.
    for key in ("sample", "progress_at", "misses"):
        state.pop(key, None)
    state.update(status=status, message=message, checked_at=now)
    return state


def observe(state, sample, now):
    previous = state.get("sample")
    continuous = previous is not None and 0 <= now - state["checked_at"] <= MAX_CHECK_GAP
    progressed = continuous and sample["cursor"] > previous["cursor"]
    fresh = 0 <= now - sample["cursor"] / 1_000_000 <= STALL_SECONDS
    if progressed and fresh:
        state["recovery_pending"] = False
    baseline = (
        not continuous or sample["container"] != previous["container"]
        or sample["started"] != previous["started"] or sample["cursor"] < previous["cursor"]
    )
    state.update(sample=sample, checked_at=now)
    if baseline or progressed:
        state.update(progress_at=now, misses=0)
    else:
        state["misses"] += 1
    if now - sample["started"] < GRACE_SECONDS:
        state.update(status="grace", message="HappyView is within its five-minute startup grace period.", progress_at=now)
    elif baseline:
        state.update(status="observing", message="Started a new cursor observation window.")
    elif progressed:
        state.update(
            status="healthy" if fresh else "catching_up",
            message="Cursor is advancing." if fresh else "Replay is advancing; no restart needed.",
        )
    elif state["misses"] < MIN_MISSES or now - state["progress_at"] < STALL_SECONDS:
        state.update(status="observing", message="Waiting for five minutes of confirmed cursor inactivity.")
    elif state["recovery_pending"]:
        state.update(status="failed", message="Ingestion is still stalled after its restart attempt; operator attention required.")
    elif state["last_restart_at"] is not None and now - state["last_restart_at"] < COOLDOWN_SECONDS:
        state.update(status="cooldown", message="Ingestion is stalled, but the fifteen-minute restart cooldown is active.")
    else:
        state.update(
            status="recovering", message="Restarting only HappyView after confirmed cursor inactivity.",
            recovery_pending=True, last_restart_at=now,
        )
        return True
    return False


def check(config, now=None):
    validate_config(config)
    now = time.time() if now is None else now
    directory = Path(config["state_dir"])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    with ExitStack() as stack:
        try:
            lock(stack, directory / "check.lock")
        except BlockingIOError:
            return {"status": "paused", "message": "Another watchdog check is running."}
        state = read_state(directory)
        try:
            # Same order as updates. Hold both through sampling and restart,
            # so a concurrent update cannot stop/migrate a database underneath us.
            lock(stack, Path(config["host_lock"]))
            lock(stack, Path(config["updater_state_dir"]) / "maintenance.lock")
        except BlockingIOError:
            pause(state, now, "paused", "Update or maintenance lock is held.")
        else:
            if (Path(config["maintenance_dir"]) / "active").exists():
                pause(state, now, "paused", "Maintenance is active.")
            else:
                try:
                    sample = sample_cursor(config)
                    if sample is None:
                        pause(state, now, "paused", "HappyView is not running; the watchdog never starts a stopped service.")
                    elif sample["cursor"] / 1_000_000 > now + 60:
                        pause(state, now, "error", "Jetstream cursor is in the future; check the host clock.")
                    elif observe(state, sample, now):
                        # Consume the budget durably BEFORE issuing a restart.
                        # A timeout, crash or failed restart must not loop.
                        write_state(directory, state)
                        try:
                            if running_since(sample["container"]) != sample["started"]:
                                state.update(status="failed", message="HappyView changed during the check; restart canceled.")
                            else:
                                run(["docker", "restart", "--timeout", "20", sample["container"]], timeout=35)
                        except WatchdogError:
                            state.update(status="failed", message="HappyView restart failed or timed out; operator attention required.")
                except WatchdogError as error:
                    pause(state, now, "error", str(error))
        write_state(directory, state)
        return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("command", choices=("check", "status", "reset"), nargs="?", default="check")
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text())
        validate_config(config)
        directory = Path(config["state_dir"])
        if args.command == "status":
            result = read_state(directory)
        elif args.command == "reset":
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            with ExitStack() as stack:
                lock(stack, directory / "check.lock")
                state = read_state(directory)
                state["recovery_pending"] = False
                result = pause(state, time.time(), "observing", "Restart budget manually rearmed; cooldown retained.")
                write_state(directory, result)
        else:
            result = check(config)
        print(json.dumps(result))
        return 1 if result["status"] in ("failed", "error", "cooldown") else 0
    except (WatchdogError, OSError, ValueError):
        print("Watchdog check failed; inspect host configuration and private state. No further restart attempted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
