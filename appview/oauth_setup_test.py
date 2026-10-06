"""Offline setup contracts. No Docker daemon, database, or network is used."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SetupTest(unittest.TestCase):
    def test_bootstrap_key_can_provision_public_oauth_clients(self):
        script = (ROOT / "appview/bootstrap-admin.sh").read_text()
        assignment = next(line for line in script.splitlines() if line.startswith("PERMISSIONS="))
        permissions = set(json.loads(assignment.split("=", 1)[1].strip("'")))
        self.assertTrue({"api-clients:view", "api-clients:create", "api-clients:edit"} <= permissions)
        self.assertNotIn("api-clients:delete", permissions)
        self.assertNotIn("*", permissions)

    def run_setup(self, failure=""):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            curl = root / "curl"
            curl.write_text("""#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
url = next(a for a in args if a.startswith('http://'))
method = args[args.index('-X') + 1] if '-X' in args else 'GET'
body = json.loads(args[args.index('-d') + 1]) if '-d' in args else None
with open(os.environ['REQUEST_LOG'], 'a') as log:
    log.write(json.dumps([method, url, body]) + '\\n')
if os.environ.get('FAIL_REQUEST') and os.environ['FAIL_REQUEST'] in url:
    sys.exit(22)
if method == 'GET':
    print(json.dumps({'mode': 'allowlist', 'nsids': ['com.atproto.repo.*'], 'routing': 'authority'}))
else:
    print('{}')
""")
            curl.chmod(0o755)
            psql = root / "psql"
            psql.write_text("#!/bin/sh\nexit 0\n")
            psql.chmod(0o755)
            log = root / "requests"
            env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                   "HAPPYVIEW_API_KEY": "hv_synthetic", "HV": "http://fixture",
                   "PG_EXEC": "", "REQUEST_LOG": str(log), "FAIL_REQUEST": failure}
            result = subprocess.run(["sh", "appview/setup.sh"], cwd=ROOT, env=env,
                                    capture_output=True, text=True)
            requests = [json.loads(line) for line in log.read_text().splitlines()]
            return result, requests

    def test_settings_proxy_policy_and_permission_sets(self):
        result, requests = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        for flag in ("spaces_enabled", "spaces_pds_migration"):
            self.assertIn(["PUT", f"http://fixture/admin/settings/feature.{flag}",
                           {"value": "true"}], requests)
        self.assertIn(["PUT", "http://fixture/admin/settings/xrpc-proxy",
                       {"mode": "allowlist", "nsids": ["com.atproto.repo.*"],
                        "routing": "serviceproxy"}], requests)
        lexicons = [body["lexicon_json"]["id"] for method, url, body in requests
                    if url.endswith("/admin/lexicons")]
        self.assertIn("app.atmobb.authForum", lexicons)
        self.assertIn("app.atmobb.authSysop", lexicons)
        self.assertFalse(any("identity" in url or "signing" in url for _, url, _ in requests))
        self.assertNotIn("hv_synthetic", result.stdout + result.stderr)

    def test_admin_failure_stops_setup(self):
        for endpoint in ("feature.spaces_enabled", "xrpc-proxy", "/admin/lexicons"):
            with self.subTest(endpoint=endpoint):
                result, requests = self.run_setup(endpoint)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("== done", result.stdout)
                self.assertTrue(requests[-1][1].endswith(endpoint))

    def test_container_version_gate_precedes_all_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            curl = root / "curl"
            curl.write_text("#!/bin/sh\nprintf '{\"version\":\"2.14.0\"}'\n")
            curl.chmod(0o755)
            node = root / "node"
            node.write_text("#!/bin/sh\necho 'unexpected OAuth configuration' >&2\nexit 1\n")
            node.chmod(0o755)
            env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                   "HAPPYVIEW_API_KEY": "hv_synthetic", "HV": "http://fixture",
                   "HAPPYVIEW_EXPECTED_VERSION": "2.16.0", "HAPPYVIEW_HOST": "hv.example"}
            result = subprocess.run(["sh", "appview/container-setup.sh"], cwd=ROOT,
                                    env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("version mismatch", result.stderr)
            self.assertNotIn("unexpected OAuth configuration", result.stderr)
            self.assertNotIn("== stats tables", result.stdout)


if __name__ == "__main__":
    unittest.main()
