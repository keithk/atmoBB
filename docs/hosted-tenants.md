# Hosted tenants

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
