#!/usr/bin/env python3
"""Root-owned, fixed-action hosting service. Never mount this socket in tenants."""
import fcntl
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import UnixStreamServer
from urllib.request import Request, urlopen

ROOT = Path('/var/lib/atmobb-hosting')
SOCKET = Path('/run/atmobb-hosting/hosting.sock')
CONFIG = Path('/etc/atmobb/hosting.json')
HOST_LOCK = Path('/var/lock/atmobb-hosting.lock')
lock = threading.RLock()
config = {}


def save(store):
    temporary = ROOT / 'state.tmp'
    temporary.write_text(json.dumps(store, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(ROOT / 'state.json')


def load():
    # Corrupt/missing state must not reset capacity and allow duplicate stacks.
    return json.loads((ROOT / 'state.json').read_text())


def hostname(value):
    return isinstance(value, str) and len(value) <= 253 and len(value.split('.')) >= 2 and all(
        re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in value.split('.'))


def bundle(instance):
    return ROOT / 'instances' / instance['id']


def instance_env(instance):
    return dict(line.split('=', 1) for line in (bundle(instance) / '.env').read_text().splitlines()
                if '=' in line and not line.startswith('#'))


def updater(instance, method='GET', target=None):
    connection = http.client.HTTPConnection('localhost', timeout=5)
    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.sock.settimeout(5)
    try:
        connection.sock.connect(f"/run/atmobb-updater-{instance['id']}/updater.sock")
        token = instance_env(instance)['ATMOBB_UPDATER_TOKEN']
        connection.request(method, '/status' if method == 'GET' else f'/update/{target}',
                           headers={'Authorization': f'Bearer {token}'})
        response = connection.getresponse()
        value = json.loads(response.read())
        if response.status >= 400:
            raise ValueError(value.get('error', 'Instance updater rejected the request.'))
        return value
    finally:
        connection.close()


def status():
    with lock:
        store = load()
    def read_update(instance):
        if instance['status'] == 'live':
            try:
                instance['update'] = updater(instance)
            except (OSError, ValueError, http.client.HTTPException, KeyError):
                instance['updateError'] = 'Instance updater unavailable; inspect its systemd service.'
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(read_update, store['instances']))
    return {**store, 'used': len(store['instances'])}


def reserve(value):
    identifier = value.get('id', '')
    try:
        if str(uuid.UUID(identifier)) != identifier:
            raise ValueError()
    except (ValueError, AttributeError, TypeError):
        raise ValueError('Invalid instance ID.')
    subdomain = value.get('subdomain', '')
    if not isinstance(subdomain, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,28}[a-z0-9]', subdomain):
        raise ValueError('Invalid subdomain.')
    if subdomain in ('www', 'mail', 'smtp', 'hv', 'admin', 'api', 'app', 'atmobb', 'forum', 'forums', 'dev', 'staging', 'test'):
        raise ValueError('Reserved subdomain.')
    did = value.get('forumDid', '')
    if not isinstance(did, str) or not re.fullmatch(r'did:[a-z0-9]+:[A-Za-z0-9._:%-]+', did):
        raise ValueError('Invalid forum DID.')
    if not hostname(value.get('adminHandle')):
        raise ValueError('Invalid administrator handle.')
    if not hostname(f"hv.{subdomain}.{config['domain']}"):
        raise ValueError('Instance hostname is too long.')
    with lock:
        store = load()
        previous = next((i for i in store['instances'] if i['id'] == identifier), None)
        if previous:
            if any(previous[key] != value[key] for key in ('subdomain', 'forumDid', 'adminHandle')):
                raise ValueError('Instance ID already belongs to another request.')
            if previous['status'] != 'failed':
                return previous
            previous['status'] = 'provisioning'
            previous.pop('error', None)
            instance = previous
        else:
            if len(store['instances']) >= store['limit']:
                raise ValueError('Hosting capacity is full. Increase the limit before approving.')
            if any(i['subdomain'] == subdomain or i['forumDid'] == did for i in store['instances']):
                raise ValueError('That subdomain or forum already has an installation.')
            ports = {i[key] for i in store['instances'] for key in ('appPort', 'happyviewPort')}
            port = config['firstPort']
            while port in ports or port + 1 in ports:
                port += 2
            if port + 1 > 65535:
                raise ValueError('No ports remain in the configured range.')
            instance = {key: value[key] for key in ('id', 'subdomain', 'forumDid', 'adminHandle')}
            instance.update(status='provisioning', appPort=port, happyviewPort=port + 1)
            store['instances'].append(instance)
        save(store)  # Persist the reservation before any external work.
        threading.Thread(target=provision, args=(dict(instance),), daemon=True).start()
        return dict(instance)


def provision(instance):
    identifier = instance['id']
    try:
        with HOST_LOCK.open('a+') as operation:
            fcntl.flock(operation, fcntl.LOCK_EX)
            destination = bundle(instance)
            if not destination.exists():
                # Copy only a trusted, operator-installed release template, never user files.
                for name in ('atmobb', 'compose.yml'):
                    if '# ATMOBB_INSTANCE_CONFIG_VERSION=1' not in (Path(config['template']) / name).read_text().splitlines():
                        raise ValueError('Template does not support isolated instances.')
                temporary = destination.with_suffix('.preparing')
                if temporary.exists():
                    shutil.rmtree(temporary)
                temporary.mkdir(parents=True, mode=0o700)
                for name in ('atmobb', 'updater.py', 'compose.yml', 'compose.caddy.yml', 'Caddyfile', 'env.example'):
                    shutil.copy2(Path(config['template']) / name, temporary / name)
                app_host = f"{instance['subdomain']}.{config['domain']}"
                (temporary / '.env').write_text(
                    f"ATMOBB_INSTANCE_ID={identifier}\nATMOBB_APP_PORT={instance['appPort']}\n"
                    f"ATMOBB_HAPPYVIEW_PORT={instance['happyviewPort']}\nAPP_HOST={app_host}\n"
                    f"HAPPYVIEW_HOST=hv.{app_host}\nATMOBB_FORUM_DID={instance['forumDid']}\n")
                (temporary / '.env').chmod(0o600)
                temporary.rename(destination)
            # Installer output can contain credentials. Keep logs root-only, never return them.
            with (destination / 'install.log').open('a') as output:
                subprocess.run([str(destination / 'atmobb'), 'install', '--yes', '--admin-handle', instance['adminHandle']],
                               cwd=destination, stdout=output, stderr=subprocess.STDOUT, check=True)
            app_host = f"{instance['subdomain']}.{config['domain']}"
            request = Request(f"http://127.0.0.1:{instance['appPort']}/.well-known/atproto-did", headers={'Host': app_host})
            for attempt in range(30):
                try:
                    with urlopen(request, timeout=5) as response:
                        if response.read().decode().strip() != instance['forumDid']:
                            raise ValueError('Instance identity health check failed.')
                    break
                except OSError:
                    if attempt == 29:
                        raise
                    time.sleep(2)
            routes = Path(config['routes'])
            route = routes / f'{identifier}.caddy'
            previous_route = route.read_text() if route.exists() else None
            route.write_text(
                f"{app_host} {{\n reverse_proxy 127.0.0.1:{instance['appPort']}\n}}\n"
                f"hv.{app_host} {{\n @admin path /admin /admin/*\n respond @admin 404\n"
                f" reverse_proxy 127.0.0.1:{instance['happyviewPort']}\n}}\n")
            route.chmod(0o644)  # Host Caddy runs as an unprivileged user.
            try:
                subprocess.run(['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], check=True, capture_output=True)
                subprocess.run(['systemctl', 'reload', 'caddy'], check=True, capture_output=True)
            except Exception:
                if previous_route is None:
                    route.unlink(missing_ok=True)
                else:
                    route.write_text(previous_route)
                raise
        result = {'status': 'live'}
    except Exception as error:
        print(f'Provisioning {identifier} failed: {error}', flush=True)
        result = {'status': 'failed', 'error': 'Provisioning failed. Operator: inspect this instance’s root-only install.log and Caddy service, then retry. Its capacity slot is retained.'}
    with lock:
        store = load()
        current = next(i for i in store['instances'] if i['id'] == identifier)
        current.update(result)
        save(store)


def dispatch(method, path, value):
    if method == 'GET' and path == '/status':
        return status()
    if method == 'POST' and path == '/capacity':
        limit = value.get('limit')
        if type(limit) is not int or not 0 <= limit <= 1000:
            raise ValueError('Limit must be an integer from 0 to 1000.')
        with lock:
            store = load()
            store['limit'] = limit
            save(store)
        return status()
    if method == 'POST' and path == '/instances':
        return reserve(value)
    match = re.fullmatch(r'/instances/([a-f0-9-]+)/update/(stable|main)', path)
    if method == 'POST' and match:
        with lock:
            instance = next((i for i in load()['instances'] if i['id'] == match[1]), None)
        if not instance or instance['status'] != 'live':
            raise ValueError('Only live isolated instances can be updated.')
        return updater(instance, 'POST', match[2])
    raise ValueError('Unsupported hosting action.')


class Handler(BaseHTTPRequestHandler):
    def handle_request(self):
        code = 200
        try:
            if not hmac.compare_digest(self.headers.get('Authorization', ''), f"Bearer {config['token']}"):
                code, value = 401, {'error': 'Unauthorized.'}
            else:
                if self.headers.get('X-Hosting-Domain') != config['domain']:
                    raise ValueError('Operator forum and hosting service domains differ.')
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 <= size <= 4096:
                    raise ValueError('Request is too large.')
                body = json.loads(self.rfile.read(size)) if size else {}
                if not isinstance(body, dict):
                    raise ValueError('Expected an object.')
                value = dispatch(self.command, self.path, body)
        except ValueError as error:
            code, value = 400, {'error': str(error)}
        except Exception:
            code, value = 503, {'error': 'Hosting service unavailable. Inspect the host service and state file.'}
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = handle_request
    do_POST = handle_request

    def log_message(self, *_):
        pass


class Server(UnixStreamServer, HTTPServer):
    address_family = socket.AF_UNIX


def main():
    global config
    os.umask(0o077)
    config = json.loads(CONFIG.read_text())
    if not hostname(config['domain']) or not 1024 <= config['firstPort'] <= 65534 or len(config['token']) < 32:
        raise ValueError('Invalid hosting configuration.')
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Initial state is created by installation, not implicitly on daemon startup.
    store = load()
    for instance in store['instances']:
        if instance['status'] == 'provisioning':
            instance.update(status='failed', error='Hosting service stopped during provisioning. Inspect the instance before retrying; slot retained.')
    save(store)
    SOCKET.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(SOCKET.parent, 0, 10001)
    os.chmod(SOCKET.parent, 0o750)
    SOCKET.unlink(missing_ok=True)
    with Server(str(SOCKET), Handler) as server:
        os.chown(SOCKET, 0, 10001)
        os.chmod(SOCKET, 0o660)
        server.serve_forever()


if __name__ == '__main__':
    main()
