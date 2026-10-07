#!/usr/bin/env python3
"""Opt-in, disposable HappyView 2.16.0/Postgres 17 contract characterization.

Run: python3 appview/tests/spaces-smoke.py --run
Requires Docker and Python 3 only; deliberately not part of vitest. Pulls images
before creating an internal network, never reads .env, uses only synthetic DIDs,
and removes its own containers/network in finally. No existing DB is supported.

API/config source: gamesgamesgamesgamesgames/happyview@cb3cd86.
This exercises the signed first-party cookie protocol from happyview-session.ts,
not OAuth, a real PDS, the TypeScript wrappers, or SDK/PDS migration.
JSON-lines output contains fixture responses, shapes, discrepancies and digests,
never request headers or generated secrets. Docker logging is disabled.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


HV_IMAGE = "ghcr.io/gamesgamesgamesgamesgames/happyview:2.16.0"
PG_IMAGE = "postgres:17"
HTTP_IMAGE = "node:22.19.0-alpine"
ROOT = Path(__file__).resolve().parents[2]
CREATOR = "did:web:creator.smoke.invalid"
MEMBER = "did:web:member.smoke.invalid"
READER = "did:web:reader.smoke.invalid"
OPERATOR = "did:web:operator.smoke.invalid"
AUTHORITY = "did:web:happyview.smoke.invalid"
SPACE_TYPE = "app.atmobb.forum.privateBoard"
COLLECTION = "app.atmobb.discussion.thread"
POLICY = {"$type": "com.atproto.simplespace.defs#memberListPolicy"}


def event(kind, **fields):
    print(json.dumps({"event": kind, **fields}, sort_keys=True), flush=True)


def shape(value):
    if isinstance(value, dict):
        return {key: shape(val) for key, val in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return type(value).__name__


class Smoke:
    def __init__(self):
        self.name = "atmobb-spaces-smoke-" + secrets.token_hex(8)
        self.pg = self.name + "-pg"
        self.hv = self.name + "-hv"
        self.sidecar = self.name + "-http"
        self.secret = secrets.token_hex(48)
        self.token = "hv_" + secrets.token_hex(24)
        self.password = secrets.token_hex(24)
        self.encryption = base64.b64encode(secrets.token_bytes(32)).decode()
        self.private = [self.secret, self.token, self.password, self.encryption]
        self.owned = []
        self.failures = []
        self.base = ""
        self.exec_http = False
        self.last_status = None
        # Ignore proxy-related host environment variables, including localhost.
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def clean(self, text):
        for secret in self.private:
            text = text.replace(secret, "[redacted]")
        return text

    def docker(self, *args, input=None, env=None, timeout=60, check=True):
        result = subprocess.run(
            ["docker", *args], input=input, capture_output=True, text=True,
            env={**os.environ, **(env or {})}, timeout=timeout,
        )
        if check and result.returncode:
            raise RuntimeError(self.clean(
                f"docker {args[0]} failed ({result.returncode}): {result.stderr}"
            ))
        return result.stdout.strip()

    def sql(self, statement):
        return self.docker(
            "exec", "-i", self.pg, "psql", "-X", "-qAt",
            "-v", "ON_ERROR_STOP=1", "-U", "happyview", "-d", "happyview",
            input=statement, timeout=15,
        )

    def cookie(self, did):
        # cookie-rs HKDF-SHA256 expand-only; first block is signing key.
        info = b"COOKIE;SIGNED:HMAC-SHA256;PRIVATE:AEAD-AES-256-GCM"
        key = hmac.new(self.secret.encode(), info + b"\x01", hashlib.sha256).digest()
        mac = base64.b64encode(hmac.new(key, did.encode(), hashlib.sha256).digest())
        raw = mac.decode() + did
        encoded = urllib.parse.quote(raw, safe="")
        self.private.extend([raw, encoded])
        return encoded

    def request(self, method, path, body=None, did=None, admin=False,
                expected=200, label=None, quiet=False, cookie=None):
        headers = {"Host": "happyview.smoke.invalid",
                   "X-Forwarded-Host": "happyview.smoke.invalid"}
        if admin:
            headers["Authorization"] = "Bearer " + self.token
        if did or cookie:
            headers["Cookie"] = "happyview_session=" + (cookie or self.cookie(did))
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if self.exec_http:
            # Docker 29 internal bridges can ignore published ports. Keep isolation
            # rather than attach an outbound-capable bridge. Credentials go only
            # over stdin; the sidecar returns status/body, never request headers.
            transport = json.loads(self.docker(
                "exec", "-i", self.sidecar, "node", "-e", """
                    let input = '';
                    process.stdin.on('data', c => input += c);
                    process.stdin.on('end', async () => {
                      try {
                        const {url, ...options} = JSON.parse(input);
                        const r = await fetch(url, {...options, redirect: 'error',
                          signal: AbortSignal.timeout(10000)});
                        console.log(JSON.stringify({status:r.status, body:await r.text()}));
                      } catch {
                        console.error('isolated HTTP request failed');
                        process.exitCode = 1;
                      }
                    });
                """, input=json.dumps({
                    "url": f"http://{self.hv}:3000" + path, "method": method,
                    "headers": headers, **({"body": data.decode()} if data else {}),
                }), timeout=15,
            ))
            status, raw = transport["status"], self.clean(transport["body"])
        else:
            req = urllib.request.Request(self.base + path, data, headers, method=method)
            try:
                response = self.http.open(req, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.status
                raw = self.clean(response.read().decode())
        try:
            value = json.loads(raw) if raw else None
        except ValueError:
            value = raw
        if path == "/admin/settings" and isinstance(value, list):
            # HappyView's settings endpoint also returns generated private keys.
            # Only the explicitly tested feature flags may enter test output.
            for setting in value:
                if any(part in setting.get("key", "") for part in ("private", "secret", "token")):
                    self.private.append(str(setting["value"]))
            visible = [setting for setting in value
                       if setting.get("key") in (
                           "feature.spaces_enabled", "feature.spaces_pds_migration")]
            raw = json.dumps(visible)
        else:
            visible = value
        if not quiet:
            event("http", label=label or path.split("?")[0], status=status,
                  shape=shape(visible), response=visible)
        allowed = expected if isinstance(expected, tuple) else (expected,)
        if status not in allowed:
            raise RuntimeError(f"{label or path}: expected {allowed}, got {status}: {raw}")
        self.last_status = status
        return value

    def xrpc(self, name, body=None, did=CREATOR, params=None, **kwargs):
        path = "/xrpc/com.atproto." + name
        if params:
            path += "?" + urllib.parse.urlencode(params)
        return self.request("POST" if body is not None else "GET", path,
                            body, did=did, **kwargs)

    def check(self, condition, description):
        event("check", passed=bool(condition), description=description)
        if not condition:
            self.failures.append(description)

    def wait(self, description, predicate, seconds=90):
        deadline = time.monotonic() + seconds
        last = "not ready"
        while time.monotonic() < deadline:
            try:
                if predicate():
                    event("ready", service=description)
                    return
            except (RuntimeError, OSError, urllib.error.URLError) as error:
                last = self.clean(str(error))
            time.sleep(1)
        raise RuntimeError(f"{description} not ready after {seconds}s: {last}")

    def start(self):
        self.docker("version", "--format", "{{.Server.Version}}", timeout=15)
        for image in (PG_IMAGE, HV_IMAGE, HTTP_IMAGE):
            self.docker("pull", image, timeout=300)
            digest = json.loads(self.docker(
                "image", "inspect", image, "--format", "{{json .RepoDigests}}"))
            event("image", image=image, digests=digest)
        # Record names before creation so partial Docker failures are cleaned too.
        self.owned.append(("network", self.name))
        self.docker("network", "create", "--internal", "--label",
                    "atmobb.spaces-smoke=" + self.name, self.name)
        self.check(self.docker("network", "inspect", self.name,
                              "--format", "{{.Internal}}") == "true",
                   "Docker network is internal")
        self.owned.append(("container", self.pg))
        self.docker(
            "run", "-d", "--name", self.pg, "--network", self.name,
            "--network-alias", "postgres", "--label", "atmobb.spaces-smoke=" + self.name,
            "--log-driver", "none", "--tmpfs", "/var/lib/postgresql/data",
            "-e", "POSTGRES_USER=happyview", "-e", "POSTGRES_DB=happyview",
            "-e", "POSTGRES_PASSWORD", PG_IMAGE, env={"POSTGRES_PASSWORD": self.password},
        )
        self.wait("Postgres 17", lambda: self.sql("SELECT 1;") == "1")
        self.owned.append(("container", self.hv))
        env = {
            "DATABASE_URL": f"postgres://happyview:{self.password}@postgres:5432/happyview",
            "SESSION_SECRET": self.secret, "TOKEN_ENCRYPTION_KEY": self.encryption,
        }
        self.private.append(env["DATABASE_URL"])
        self.docker(
            "run", "-d", "--name", self.hv, "--network", self.name,
            "--label", "atmobb.spaces-smoke=" + self.name, "--log-driver", "none",
            "-p", "127.0.0.1::3000", "-e", "DATABASE_URL", "-e", "SESSION_SECRET",
            "-e", "TOKEN_ENCRYPTION_KEY", "-e", "PUBLIC_URL=https://happyview.smoke.invalid",
            "-e", "JETSTREAM_URL=ws://127.0.0.1:9",
            "-e", "RELAY_URL=http://127.0.0.1:9", "-e", "PLC_URL=http://127.0.0.1:9",
            "-e", "TELEMETRY_COLLECTOR_URL=http://127.0.0.1:9",
            HV_IMAGE, env=env,
        )
        event("container_state", state=json.loads(self.docker(
            "container", "inspect", self.hv, "--format", "{{json .State}}")),
            port_bindings=json.loads(self.docker(
                "container", "inspect", self.hv, "--format", "{{json .HostConfig.PortBindings}}")),
            ports=json.loads(self.docker(
                "container", "inspect", self.hv, "--format", "{{json .NetworkSettings.Ports}}")))
        port = self.docker("port", self.hv, "3000/tcp", check=False)
        if not port:
            self.exec_http = True
            self.owned.append(("container", self.sidecar))
            self.docker(
                "run", "-d", "--name", self.sidecar, "--network", self.name,
                "--label", "atmobb.spaces-smoke=" + self.name, "--log-driver", "none",
                HTTP_IMAGE, "node", "-e", "setInterval(() => {}, 60000)")
            event("transport", mode="docker-exec HTTP",
                  reason="Internal bridge did not publish port; retaining no-egress isolation")
        else:
            if not port.startswith("127.0.0.1:") or "\n" in port:
                raise RuntimeError("Expected exactly one loopback-only HappyView port")
            self.base = "http://" + port
            event("transport", mode="loopback HTTP")
        self.wait("HappyView HTTP", lambda: self.request(
            "GET", "/health", quiet=True) is not False)
        self.wait("HappyView Postgres migrations", lambda: self.sql(
            "SELECT to_regclass('public.happyview_users') IS NOT NULL;") == "t")
        migrations = self.sql(
            "SELECT count(*) || ':' || bool_and(success)::text FROM _sqlx_migrations;")
        event("postgres_migrations", applied=migrations)
        self.check(migrations.endswith(":true"), "all Postgres schema migrations succeeded")
        columns = self.sql("""
            SELECT table_name || '.' || column_name FROM information_schema.columns
            WHERE table_schema='public' AND
            ((table_name='happyview_space_members' AND column_name IN ('can_read','can_write'))
             OR (table_name='happyview_spaces' AND column_name IN ('read_policy','write_policy')))
            ORDER BY 1;
        """).splitlines()
        event("postgres_columns", columns=columns)
        self.check(len(columns) == 4, "split policies and member booleans exist in Postgres")

    def bootstrap(self):
        # Mirrors bootstrap-admin.sh; only random key hash is inserted.
        digest = hashlib.sha256(self.token.encode()).hexdigest()
        self.sql(f"""
            INSERT INTO happyview_users (id,did,is_super,created_at)
            VALUES ('smoke-operator','{OPERATOR}',1,now());
            INSERT INTO happyview_api_keys
              (id,user_id,name,key_hash,key_prefix,permissions,created_at)
            VALUES ('smoke-key','smoke-operator','disposable smoke','{digest}','hv_test',
                    '["settings:manage","lexicons:create"]',now());
        """)
        for key in ("feature.spaces_enabled", "feature.spaces_pds_migration"):
            self.request("PUT", "/admin/settings/" + key, {"value": "true"},
                         admin=True, expected=204)
        settings = self.request("GET", "/admin/settings", admin=True)
        self.check(all(any(s["key"] == key and s["value"] == "true" for s in settings)
                       for key in ("feature.spaces_enabled", "feature.spaces_pds_migration")),
                   "spaces and PDS migration flags persisted via admin API")
        self.request("PUT", "/admin/settings/xrpc-proxy",
                     {"mode": "disabled", "nsids": []}, admin=True, expected=204)
        proxy = self.request("GET", "/admin/settings/xrpc-proxy", admin=True)
        self.check(proxy["mode"] == "disabled", "proxy config round-trips via dedicated API")
        self.request("PUT", "/admin/service-identity", {"mode": "did_web"},
                     admin=True, expected=204)
        event("identity", mode="did_web",
              note="Instance authority is verified from createSpace URI, not public DID resolution")
        # Local uploads, no network-lexicons endpoint and no backfill.
        for relative in ("richtext/facet", "richtext/block", "discussion/thread"):
            lexicon = json.loads((ROOT / "lexicons/app/atmobb" / (relative + ".json")).read_text())
            self.request("POST", "/admin/lexicons",
                         {"lexicon_json": lexicon, "backfill": False},
                         admin=True, expected=201, label="local lexicon " + lexicon["id"])

    def contracts(self):
        # Invalid MAC must not authenticate, even though syntactically a DID follows it.
        self.xrpc("space.listSpaces", did=None, cookie=urllib.parse.quote(
            base64.b64encode(bytes(32)).decode() + CREATOR, safe=""),
            expected=401, label="invalid signed cookie")
        spaces = []
        for board in ("smoke-board-a", "smoke-board-b"):
            board_uri = f"at://{CREATOR}/app.atmobb.forum.board/{board}"
            key = "board-" + hashlib.sha256(board_uri.encode()).hexdigest()
            payload = {
                "spaceType": SPACE_TYPE, "skey": key, "displayName": board,
                "readPolicy": POLICY, "writePolicy": POLICY,
                "config": {"allowedCollections": [COLLECTION]},
            }
            created = self.xrpc("simplespace.createSpace", payload, expected=201)
            uri = created["uri"]
            spaces.append(uri)
            self.check(uri == f"at://{AUTHORITY}/space/{SPACE_TYPE}/{key}",
                       "space URI uses instance authority and deterministic forum-scoped board key")
        space = spaces[0]
        page1 = self.xrpc("space.listSpaces", params={"spaceType": SPACE_TYPE, "limit": 1})
        self.check(bool(page1.get("cursor")), "listSpaces returns cursor for pagination")
        page2 = self.xrpc("space.listSpaces", params={
            "spaceType": SPACE_TYPE, "limit": 1, "cursor": page1["cursor"]})
        views = page1["spaces"] + page2["spaces"]
        self.check({view["uri"] for view in views} == set(spaces)
                   and all(view["isOwner"] for view in views),
                   "listSpaces pages identify creator as owner, not URI authority")
        self.xrpc("simplespace.createSpace", payload, expected=409, label="duplicate board key")
        metadata = self.xrpc("simplespace.getSpace", params={"space": space})
        self.check(metadata["config"].get("readPolicy") == POLICY
                   and metadata["config"].get("writePolicy") == POLICY,
                   "getSpace exposes separate memberList read/write policies")

        def member(did, read, write):
            self.xrpc("simplespace.putMember", {
                "space": space, "did": did, "read": read, "write": write}, expected=201)

        member(MEMBER, True, True)
        member(READER, True, False)
        members = self.xrpc("simplespace.listMembers", params={"space": space})
        self.check(any(m["did"] == MEMBER and m["read"] and m["write"]
                       for m in members["members"]), "putMember preserves independent read/write")
        record = {
            "$type": COLLECTION,
            "board": f"at://{CREATOR}/app.atmobb.forum.board/smoke-board-a",
            "title": "Disposable private thread", "createdAt": "2026-01-01T00:00:00Z",
        }
        created = self.xrpc("space.createRecord", {
            "space": space, "collection": COLLECTION, "record": record},
            did=MEMBER, expected=201)
        rkey = created["uri"].rsplit("/", 1)[1]
        params = {"space": space, "collection": COLLECTION, "rkey": rkey}
        fetched = self.xrpc("space.getRecord", params=params, did=READER)
        self.check(fetched["value"] == record and fetched["cid"] == created["cid"],
                   "reader can fetch member-authored record by collection/rkey")
        self.xrpc("space.createRecord", {
            "space": space, "collection": COLLECTION, "record": record},
            did=READER, expected=403, label="read-only member cannot write")
        listing = self.xrpc("space.listRecords", did=CREATOR, params={
            "space": space, "repo": MEMBER, "collection": COLLECTION, "includeValues": "true"})
        self.check(len(listing["records"]) == 1 and listing["records"][0]["value"] == record,
                   "listRecords repo + includeValues returns member record")
        default = self.xrpc("space.listRecords", did=CREATOR, params={
            "space": space, "repo": MEMBER, "collection": COLLECTION})
        self.check(all("value" not in r for r in default["records"]),
                   "listRecords omits values unless includeValues=true")
        own = self.xrpc("space.listRecords", params={"space": space, "includeValues": "true"})
        self.check(own["records"] == [], "cookie listRecords without repo defaults to caller's repo")
        repos = self.xrpc("space.listRepos", params={"space": space})
        self.check({repo["did"] for repo in repos["repos"]} == {MEMBER},
                   "listRepos is writer set, not member list")
        missing = self.xrpc("space.getRecord", params={
            **params, "rkey": "missing"}, expected=404, label="missing record named error")
        event("contract_note", method="space.getRecord", error=missing.get("error"),
              named_error=missing.get("error") in ("NotFound", "RecordNotFound"),
              note="Capture actual error field; never assume all 404s mean a missing record")
        self.xrpc("space.createRecord", {
            "space": space, "collection": "app.atmobb.poll.vote",
            "record": {"$type": "app.atmobb.poll.vote"}},
            did=MEMBER, expected=400, label="collection allowlist enforced")
        # Another writer makes a cross-repo leak distinguishable from a permissive
        # own-record rule. Check the writer set before introducing this fixture.
        self.xrpc("space.createRecord", {
            "space": space, "collection": COLLECTION,
            "record": {**record, "title": "Creator-only authored fixture"}}, expected=201)
        # Continue characterization even if the engine violates a denial contract.
        for write in (True, False):
            member(MEMBER, False, write)
            access = f"read=false write={str(write).lower()}"
            for endpoint, query in (
                ("space.getRecord", params),
                ("space.listRecords", {"space": space, "includeValues": "true"}),
                ("space.listRecords", {"space": space, "repo": CREATOR, "includeValues": "true"}),
                ("space.listRepos", {"space": space}),
            ):
                target = endpoint + (" other-author" if query.get("repo") == CREATOR else "")
                response = self.xrpc(endpoint, did=MEMBER, params=query,
                                     expected=(200, 403), label=access + " " + target)
                self.check(self.last_status == 403 and isinstance(response, dict)
                           and bool(response.get("error")),
                           access + " denies " + target)
        self.xrpc("simplespace.removeMember", {"space": space, "did": MEMBER})
        for endpoint, query in (
            ("space.getRecord", params),
            ("space.listRecords", {"space": space, "includeValues": "true"}),
            ("space.listRepos", {"space": space}),
        ):
            self.xrpc(endpoint, did=MEMBER, params=query, expected=403,
                      label="removed member " + endpoint)
        event("limits", notes=[
            "Signed first-party cookie wire protocol tested, not TypeScript execution or OAuth.",
            "Fresh Postgres SQL migrations tested; flag enabled, no SDK/PDS repo migration claimed.",
            "Local record lexicons registered; collection allowlist tested, not schema validation.",
            "No real identity, external DID resolution, PDS, notification delivery, or public firehose.",
        ])

    def cleanup(self):
        errors = []
        for kind, name in reversed(self.owned):
            try:
                # Never remove an existing resource with an unrelated owner label.
                label = self.docker(kind, "inspect", name, "--format",
                                    '{{index .Config.Labels "atmobb.spaces-smoke"}}'
                                    if kind == "container" else
                                    '{{index .Labels "atmobb.spaces-smoke"}}', check=False)
                if label == self.name:
                    if kind == "container":
                        self.docker("rm", "-f", "-v", name)
                    else:
                        self.docker("network", "rm", name)
                    event("cleanup", resource=name, removed=True)
            except Exception as error:
                errors.append(self.clean(str(error)))
        if errors:
            raise RuntimeError("Cleanup failed: " + "; ".join(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="explicitly opt into disposable Docker test")
    args = parser.parse_args()
    if not args.run:
        parser.error("opt-in required: pass --run (creates disposable Docker resources)")
    smoke = Smoke()
    def interrupted(signum, frame):
        raise KeyboardInterrupt("signal " + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    status = 0
    try:
        smoke.start()
        smoke.bootstrap()
        smoke.contracts()
        if smoke.failures:
            raise RuntimeError("Contract discrepancies: " + "; ".join(smoke.failures))
        event("result", status="passed")
    except (Exception, KeyboardInterrupt) as error:
        event("result", status="failed", error=smoke.clean(str(error)))
        status = 1
    finally:
        try:
            smoke.cleanup()
        except Exception as error:
            event("cleanup_failed", error=smoke.clean(str(error)))
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main())
