# Hosted tenants

New hosted forums use **one isolated Compose installation per forum**, with an app, Happyview, PostgreSQL, secrets, OAuth storage, and updater. Hosting is opt-in on one operator forum. Its `/admin/hosting` page owns invitations, approvals, an additional-forum limit, and fleet update controls. Tenant admins use their own `/admin/updates`.

**Experimental:** 2 GB RAM is an unbenchmarked planning target, not a supported minimum or a disk footprint. Measure install/backfill, ordinary use, backups, and stable/main update peaks on your host before accepting tenants. Each Happyview can index network-wide records; disk growth is not necessarily limited to one forum. The limit counts installations, not RAM reservations. It excludes the operator forum and legacy installations, which still consume resources. PostgreSQL's 200-connection ceiling is not a host sizing formula.

Members-only boards can use each installation's own session secret. This separates tenants, **not the infrastructure owner**: the operator can read the app's data and database. Plugins executing arbitrary code are not promised a secure sandbox by this topology. Billing, automatic migration, deletion, and bulk updates are not included.

## Install the hosting controller

This first backend supports a Linux host with systemd, Docker Compose v2.20+, Python 3, and **host Caddy**. The host's Caddy owns ports 80/443; do not run bundled Caddy in hosted stacks. Keep the existing operator forum behind the same ingress. Install the release prerequisites (`curl`, `jq`, `openssl`, `sudo`) too.

Use a trusted release bundle built from code containing `ATMOBB_INSTANCE_CONFIG_VERSION=1`. A published app image including Admin → Updates is required for tenants, and the operator image must include Admin → Hosting's fleet controls. Source changes alone do not update an older pinned published image. Do not advertise this service before publishing and testing a corresponding release. Old release candidates lacking multi-instance support are deliberately rejected by the updater before activation.

1. Choose a dedicated hosting domain, e.g. `forums.example.net`. Point `*.forums.example.net` at the host. Also arrange DNS for `hv.<tenant>.forums.example.net`: a first-level wildcard is not a wildcard certificate for nested names. Caddy obtains individual certificates using HTTP challenges. Do not reuse a suffix containing unmanaged/legacy sites without reserving those names; existing Caddy routes and legacy sites must not collide.
2. Add this top-level line to `/etc/caddy/Caddyfile` (keep the operator forum's existing routes):

   ```caddyfile
   import /etc/caddy/atmobb-hosting/*.caddy
   ```

3. From this repository, run the opt-in installer, supplying a **trusted release bundle directory**, not an installation containing tenant state:

   ```sh
   sudo sh infra/install-hosting.sh forums.example.net /srv/atmobb-release
   ```

   This copies a credential-free template, installs `atmobb-hosting.service`, creates root-only configuration/state, and starts with capacity **zero**. Read `/etc/atmobb/hosting.json` securely to configure the loopback port range (default starts at 12000); reserve that range exclusively for this controller before approving forums. Do not change domain or port allocation under existing instances.

4. Securely merge the two variables in `/etc/atmobb/hosting-app.env` into the **operator forum's** `.env`, keeping mode 600. Copy `infra/release/compose.hosting.yml` beside its `compose.yml`, and set:

   ```dotenv
   COMPOSE_FILE=compose.yml:compose.hosting.yml
   ```

   Recreate the operator app with its normal Compose project. This overlay enables hosting and mounts the controller socket only in the operator app. Never copy the overlay, hosting token, controller state, or controller socket into a tenant. The operator forum must already have its admin staff configured. The admin actions and page load explicitly check forum-admin authorization.

5. In `/admin/hosting`, set the maximum number of **additional isolated forums**, create an invite, and approve a request. Setting zero pauses new approvals; lowering a limit never stops or deletes an existing forum. Pending requests do not reserve a slot; approval does, atomically, before creating anything.

The hosting controller is separate from tenant updates. Update its root-owned code/template deliberately by rerunning the installer during a maintenance window with no provisioning/update running. This does not upgrade existing tenants. Do not run multiple hosting controllers against the same state.

## Instance identity and recovery

The request's UUID is the permanent `ATMOBB_INSTANCE_ID`. For `<id>`, the controller creates:

| Resource | Location / identity |
|---|---|
| Bundle, `.env`, install log, local backups | `/var/lib/atmobb-hosting/instances/<id>/` |
| Compose project (network and DB volume prefix) | `atmobb-<id>` |
| OAuth data | `/var/lib/atmobb/<id>/oauth` |
| Updater socket (only this tenant mounts it) | `/run/atmobb-updater-<id>/updater.sock` |
| Updater state | `/var/lib/atmobb-updater-<id>/` |
| Root-owned worker | `/usr/local/lib/atmobb-<id>/` |
| Updater config / unit | `/etc/atmobb/updater-<id>.env` / `atmobb-updater-<id>.service` |
| Caddy routes | `/etc/caddy/atmobb-hosting/<id>.caddy` |

`.env` persists the instance ID, `COMPOSE_PROJECT_NAME`, `ATMOBB_APP_PORT`, `ATMOBB_HAPPYVIEW_PORT`, data path, socket path, and unique secrets. Run `./atmobb` from that instance's bundle for backup/status/recovery; never copy another installation's `.env`. The default instance ID `atmobb` preserves the historical single-install paths.

Provisioning reserves its slot and port pair durably, starts the stack through the existing installer, checks the served forum DID, writes routes that block Happyview `/admin`, validates Caddy, and reloads it. A failed provision **retains its slot and ports**, even if the operator lowers the limit. Retry reuses the same instance and preserves secrets. If the controller restarts during provisioning, it marks the interrupted operation failed for inspection rather than silently creating another stack. Corrupt state fails closed. Never reset `state.json` to free slots; reconcile containers, volumes, ingress and updater units first. Destructive cleanup remains an explicit operator task.

Stable/main updates from either admin panel use the same per-instance updater. All updater daemons and provisioning share `/var/lock/atmobb-hosting.lock`, so expensive managed operations wait for one another host-wide. A waiting update is visible and cannot be double-submitted. This lock does not constrain manual Docker commands or guarantee enough RAM for a main build alongside running forums. Use stable releases on small hosts.

Updates prepare images before replacement, back up before migrations, rerun setup, and check versions/images/container health. Backups are local and contain credentials/private data: copy them off-host and test restoration. Also back up the hosting controller's `state.json`, configuration, and Caddy routes. No automatic rollback of forward-only migrations is promised. Real Happyview migration/restore and measured multi-stack capacity remain deployment acceptance checks, separate from mocked orchestration tests.

## Legacy shared hosting (migration reference)

The following describes existing deployments only. The web queue no longer creates shared-Happyview sites or retries legacy sites. They remain visible as **legacy shared hosting**; no migration, private-board capability, or independent Happyview updater is automatically added. Migrate with an explicit data/OAuth/ingress cutover plan and backups. The old manual provisioning script remains a legacy operator tool, not the new hosting path.

Running someone else's forum on your infrastructure: one shared Happyview appview, one app installation per forum. This is how I host other people's forums on atmobb.app. If you're self-hosting your own forum, skip this page.

A hosted tenant is a vanilla build of this repo with its own env, its own OAuth client, and its own persistent OAuth state. The shared appview needs no per-tenant configuration at all. Happyview indexes `app.atmobb.*` collections network-wide off Jetstream, so a new forum costs the instance nothing but query traffic.

Tenants don't get members-only boards. Space sessions are minted with Happyview's shared `SESSION_SECRET`, and any process holding it can mint a session for any DID, every private space on the instance included. So tenant apps never receive `HAPPYVIEW_SESSION_SECRET`, and the app hides and rejects the members-only option without it. A community that needs private boards should self-host.

> [!IMPORTANT]
> Be upfront with tenants about what you can see. You run their app process, so you can read whatever it can, and the Postgres behind the shared index is yours. That asymmetry is why tenants don't get private boards: everything in a hosted forum is public to the network anyway.

## Provisioning

```sh
DEPLOY_SESSION_TOKEN=... sh infra/provision-tenant.sh cool-forum their-forum.bsky.social
```

The script resolves the forum account's DID, creates a deploy-dashboard site from this repo (public, persistent storage, sleeps when idle), assigns the tenant's subdomain as a custom domain, mints the tenant its own Happyview API client for rate limiting, writes the env, deploys, and waits until `/.well-known/atproto-did` serves the right DID. It prints the tenant's onboarding checklist at the end. Like `infra/appview-compose.yml`, it assumes my deploy dashboard, so adapt it if your hosting looks different.

Tenant subdomains need a wildcard DNS record pointing at the host (`*.atmobb.app` in atmobb.app's case). Caddy's on-demand TLS mints each certificate on the first visit, gated by the dashboard's domain validation, so there's no per-tenant DNS or certificate step.

The tenant brings their own dedicated atproto account for the forum identity, with the same [self-hosting warning](self-hosting.md#before-you-start): that account owns the forum.

The webring and cross-forum thread links build forum URLs as `https://<forum handle>`, and every deployment serves its forum DID at `/.well-known/atproto-did`. After connecting, the tenant should change the forum account's handle to the site's domain. HTTP verification works immediately, without a DNS record.

Notifications need nothing from the tenant either. The app generates its atmo.pub signing key on first boot into the site's persistent storage and serves its sender identity at `/.well-known/did.json`, so each tenant forum is its own sender under its own domain.

[Membership](features.md#membership) (join modes, applications, invites) needs no operator step either; none of it touches the session secret. One thing to know: a tenant's invite links are `/join/<token>` URLs, and the token is the whole secret, so every redeemed and unredeemed invite lands in the host's access logs. Keep log retention short.

[Stamps](features.md#stamps) need no per-tenant step either. A tenant's stamp records live in its own forum repo, and the shared appview issues one network set to every forum it serves. Taking stamps live is one setup and backfill on the shared appview, after at least one site has redeployed, as with any release that touches `appview/`.

## The invite queue

Signup can also be self-serve. Set `ATMOBB_HOSTING=1` and a dashboard `DEPLOY_SESSION_TOKEN` on the one deployment that offers hosting, and it grows two pages. `/host` is public: someone with an invite code logs in, claims a subdomain, and names their forum account. Admin → Hosting is where invite codes get minted and requests get approved or rejected. Approving one provisions the site through the dashboard automatically and the page flips it to live once the new forum serves its DID.

Invites are single-use, and I require one to sign up, because an open form is an open invitation to squat subdomains. The queue provisions everything except the tenant's Happyview client key, which still needs the loopback admin API; mint one by hand when a tenant deserves its own rate limit.

| variable | purpose |
|---|---|
| `ATMOBB_HOSTING` | `1` turns the queue on. Off, neither page exists. |
| `DEPLOY_SESSION_TOKEN` | Dashboard session token the app provisions with. Guard it; it can create and delete sites. |
| `DEPLOY_API` | Dashboard base URL. Defaults to `https://admin.keith.is`. |
| `ATMOBB_HOSTING_DOMAIN_SUFFIX` | Domain tenants land under. Defaults to `atmobb.app`. |
| `ATMOBB_HOSTING_GIT_URL` | Repo tenant sites build from. Defaults to this one. |
| `RESEND_API_KEY` | Turns on email notification when a request goes live or gets rejected. Requesters can leave an email address either way; without a key nothing sends and /host stays the source of truth. |
| `ATMOBB_HOSTING_EMAIL_FROM` | Sender for those emails. Defaults to `atmobb <forums@atmobb.app>`; the domain has to be verified with Resend. |

## Operations

- **Suspending:** stop or delete the site in the dashboard. This takes down the frontend and nothing else. Records stay on the network and in the index.
- **Delisting:** insert the forum's DID into `atmobb_delisted_forums` on the appview to hide it from the directory, the webring, and topic federation. See [Delisting a forum](happyview.md#delisting-a-forum).
- **Rate limiting:** each tenant's `HAPPYVIEW_CLIENT_KEY` identifies its read traffic to Happyview.
- **Upgrades:** tenant sites build from `main`, so redeploy each site after a push. The droplet's repo checkout only refreshes on a redeploy too, so when a release touches `appview/` or `lexicons/`, redeploy at least one site first, then rerun `appview/setup.sh`.
