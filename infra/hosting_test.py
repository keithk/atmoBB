import concurrent.futures
import http.client
import importlib.util
import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SPEC = importlib.util.spec_from_file_location("hosting", Path(__file__).with_name("hosting.py"))
hosting = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hosting)


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost")
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.path)


class HostingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        hosting.ROOT = self.root
        hosting.config = {
            "domain": "example.test",
            "firstPort": 12000,
            "token": "test-only",
        }
        hosting.save({"limit": 2, "instances": []})
        self.started = []
        patcher = mock.patch.object(hosting, "threading", SimpleNamespace(Thread=self.fake_thread))
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self):
        self.temp.cleanup()

    def fake_thread(self, *, target, args, daemon):
        worker = mock.Mock()
        worker.start.side_effect = lambda: self.started.append((target, args, daemon))
        return worker

    def request(self, number, **changes):
        value = {
            "id": f"00000000-0000-4000-8000-{number:012d}",
            "subdomain": f"tenant{number}",
            "forumDid": f"did:plc:forum{number}",
            "adminHandle": f"admin{number}.example.test",
        }
        value.update(changes)
        return value

    def test_capacity_reservation_is_atomic_and_assigns_distinct_port_pairs(self):
        first = hosting.reserve(self.request(1))
        second = hosting.reserve(self.request(2))
        self.assertEqual((first["appPort"], first["happyviewPort"]), (12000, 12001))
        self.assertEqual((second["appPort"], second["happyviewPort"]), (12002, 12003))

        hosting.save({"limit": 1, "instances": []})
        barrier = threading.Barrier(2)

        def approve(value):
            barrier.wait()
            try:
                return hosting.reserve(value)
            except ValueError as error:
                return error

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(approve, (self.request(3), self.request(4))))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(sum(isinstance(result, ValueError) for result in results), 1)
        self.assertEqual(len(hosting.load()["instances"]), 1)

    def test_same_request_is_idempotent_without_duplicate_provisioning(self):
        value = self.request(1)
        first = hosting.reserve(value)
        second = hosting.reserve(dict(value))
        self.assertEqual(second, first)
        self.assertEqual(len(hosting.load()["instances"]), 1)
        self.assertEqual(len(self.started), 1)

    def test_failed_retry_retains_slot_and_ports_after_limit_is_reduced(self):
        original = hosting.reserve(self.request(1))
        store = hosting.load()
        store["instances"][0].update(status="failed", error="failed")
        store["limit"] = 0
        hosting.save(store)

        retried = hosting.reserve(self.request(1))
        self.assertEqual(retried["status"], "provisioning")
        self.assertEqual(retried["appPort"], original["appPort"])
        self.assertEqual(retried["happyviewPort"], original["happyviewPort"])
        self.assertEqual(len(hosting.load()["instances"]), 1)
        self.assertEqual(len(self.started), 2)

    def test_conflicting_id_and_duplicate_forum_or_domain_are_rejected(self):
        hosting.reserve(self.request(1))
        cases = (
            self.request(1, subdomain="different"),
            self.request(2, subdomain="tenant1"),
            self.request(3, forumDid="did:plc:forum1"),
        )
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                hosting.reserve(value)
        self.assertEqual(len(hosting.load()["instances"]), 1)

    def test_corrupt_state_fails_closed(self):
        (self.root / "state.json").write_text("not json")
        with self.assertRaises(json.JSONDecodeError):
            hosting.reserve(self.request(1))
        self.assertEqual(self.started, [])

    def test_rejects_injection_and_path_inputs(self):
        bad_values = (
            self.request(1, id="../../etc/passwd"),
            self.request(1, subdomain="tenant/../../x"),
            self.request(1, subdomain="tenant.example"),
            self.request(1, forumDid="did:plc:ok\nEVIL=yes"),
            self.request(1, adminHandle="admin.example.test\nEVIL=yes"),
            self.request(1, adminHandle="../../etc/passwd"),
        )
        for value in bad_values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                hosting.reserve(value)
        self.assertEqual(hosting.load()["instances"], [])

    def test_update_dispatch_only_for_known_live_instance_and_fixed_targets(self):
        live = hosting.reserve(self.request(1))
        dead = hosting.reserve(self.request(2))
        store = hosting.load()
        store["instances"][0]["status"] = "live"
        store["instances"][1]["status"] = "failed"
        hosting.save(store)

        with mock.patch.object(hosting, "updater", return_value={"ok": True}) as updater:
            for target in ("stable", "main"):
                self.assertEqual(
                    hosting.dispatch("POST", f'/instances/{live["id"]}/update/{target}', {}),
                    {"ok": True},
                )
            self.assertEqual([call.args[2] for call in updater.call_args_list], ["stable", "main"])
            for method, identifier, target in (
                ("GET", live["id"], "stable"),
                ("POST", live["id"], "edge"),
                ("POST", dead["id"], "stable"),
                ("POST", "00000000-0000-4000-8000-999999999999", "main"),
                ("POST", "../../etc/passwd", "stable"),
            ):
                with self.subTest(method=method, identifier=identifier, target=target), self.assertRaises(ValueError):
                    hosting.dispatch(method, f"/instances/{identifier}/update/{target}", {})
            self.assertEqual(updater.call_count, 2)

    def test_provision_preserves_identity_and_secrets_on_retry_and_blocks_happyview_admin(self):
        instance = hosting.reserve(self.request(1))
        template = self.root / 'template'
        template.mkdir()
        for name in ('atmobb', 'compose.yml', 'updater.py', 'compose.caddy.yml', 'Caddyfile', 'env.example'):
            (template / name).write_text('# ATMOBB_INSTANCE_CONFIG_VERSION=1\n')
        routes = self.root / 'routes'
        routes.mkdir()
        hosting.config.update(template=str(template), routes=str(routes))
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'did:plc:forum1'
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if command[1] == 'install':
                env_path = hosting.bundle(instance) / '.env'
                if 'ATMOBB_UPDATER_TOKEN=' not in env_path.read_text():
                    with env_path.open('a') as out:
                        out.write('ATMOBB_UPDATER_TOKEN=preserved-fixture\n')
        with mock.patch.object(hosting, 'HOST_LOCK', self.root / 'host.lock'), \
                mock.patch.object(hosting.subprocess, 'run', side_effect=run), \
                mock.patch.object(hosting, 'urlopen', return_value=response):
            hosting.provision(instance)
            initial_env = (hosting.bundle(instance) / '.env').read_text()
            hosting.provision(instance)
        self.assertEqual(hosting.load()['instances'][0]['status'], 'live')
        self.assertEqual((hosting.bundle(instance) / '.env').read_text(), initial_env)
        self.assertIn('ATMOBB_APP_PORT=12000\nATMOBB_HAPPYVIEW_PORT=12001', initial_env)
        self.assertIn(f"ATMOBB_INSTANCE_ID={instance['id']}", initial_env)
        self.assertNotIn('COMPOSE_FILE', initial_env)
        self.assertNotIn('ATMOBB_HOSTING_TOKEN', initial_env)
        route = routes / f"{instance['id']}.caddy"
        self.assertIn('tenant1.example.test {', route.read_text())
        self.assertIn('hv.tenant1.example.test {', route.read_text())
        self.assertIn('@admin path /admin /admin/*\n respond @admin 404', route.read_text())
        self.assertEqual(route.stat().st_mode & 0o777, 0o644)
        self.assertEqual([cmd[0] if cmd[0] in ('caddy', 'systemctl') else 'install' for cmd in calls],
                         ['install', 'caddy', 'systemctl', 'install', 'caddy', 'systemctl'])

    def test_wrong_socket_bearer_does_not_dispatch(self):
        socket_path = self.root / "hosting.sock"
        server = hosting.Server(str(socket_path), hosting.Handler)
        self.addCleanup(server.server_close)
        with mock.patch.object(hosting, "dispatch") as dispatch:
            serving = threading.Thread(target=server.handle_request)
            serving.start()
            connection = UnixConnection(str(socket_path))
            connection.request("GET", "/status", headers={"Authorization": "Bearer wrong"})
            response = connection.getresponse()
            body = json.loads(response.read())
            connection.close()
            serving.join(timeout=2)
            self.assertFalse(serving.is_alive())
            self.assertEqual(response.status, 401)
            self.assertEqual(body, {"error": "Unauthorized."})
            dispatch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
