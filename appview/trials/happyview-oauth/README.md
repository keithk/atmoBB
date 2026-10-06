# HappyView OAuth compatibility trial

This suite characterizes the unmodified HappyView Node SDK with atmoBB's `Agent` request patterns. It bypasses the application's OAuth adapter, so its assertions include raw SDK behaviors that the application handles separately.

The application adapter handles browser binding, issuer/account validation, per-login scope fallback, and PAR nonce retries. Its tests live in `src/lib/server/happyview-oauth.test.ts`, `src/lib/server/happyview-transport.test.ts`, and `src/routes/oauth/callback/server.test.ts`.

## Run

Requires Node 22.19+ and Bun. From the repository root:

```sh
cd appview/trials/happyview-oauth
bun install --frozen-lockfile --ignore-scripts
bun run test
```

Installation downloads public packages. The tests themselves make **no network requests**: identity resolution and service responses are synthetic. All unexpected HTTP destinations are rejected. Signing keys are generated at runtime; there are no real accounts, passwords, tokens, or production writes.

The persistence test starts a separate Node process. Its synthetic session files go under `DELTA_SCRATCH_DIR` when available, otherwise this package's ignored `node_modules/.cache/`. They are not production credentials and should not be used as a session-storage implementation.

## Versions and evidence boundary

The isolated package pins:
- `@atproto/api` **0.20.42**, matching atmoBB's root lockfile.
- `@happyview/oauth-client-node` **1.0.1**; npm `gitHead` is `c1b308851593c742a96e6211334b2177ed9a3013`.
- `@happyview/oauth-client` **1.4.2**; npm `gitHead` is `4142df1f697180ad307c4298dc28e01c5aa615bf`.
- Server references use HappyView **v2.16.0**, commit `cb3cd86ab0fb6db1f20c4f31dc02e3747608210f`. This suite does not start HappyView or a PDS.

SDK packages have independent versions from the server. The package versions above identify the executed code; the server commit identifies the sources cited below.

The suite uses the **real published SDK, real `Agent`, and real P-256 signatures**. It validates outgoing DPoP signatures, methods, destination URLs, token hashes, PKCE handoffs, request bodies, and local session persistence. It does not test HappyView's permission enforcement, refresh execution, or PDS acceptance.

The minimum-runtime check can be repeated from this trial's directory after installing dependencies:

```sh
docker run --rm --network none \
  --mount "type=bind,src=$PWD,dst=/trial,readonly" \
  --workdir /trial --env DELTA_SCRATCH_DIR=/tmp \
  node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9 \
  node --test characterize.mjs
```

## Test coverage

The characterization tests include assertions for undesirable SDK behavior. A passing suite confirms those assertions; it does not establish production compatibility.

| Case | Assertion |
|---|---|
| Member and forum authorization | Separate scopes and sessions can be registered and restored by DID. |
| Restored `new Agent(session)` | Relative XRPC calls go to HappyView, not directly to the PDS. |
| Record operations | Create, put, delete, applyWrites, and list requests retain the expected HTTP shape. |
| Blobs | Image/font bytes and MIME type survive SDK transport unchanged. |
| Notification service auth | `getServiceAuth` is a **GET**, preserving the relay audience and method binding. |
| Extension consent | Explicitly returned forum scopes are retained separately from member scopes. |
| HappyView DPoP nonce | SDK retries once with the nonce and a fresh valid proof. |
| Rejected HappyView credential | SDK propagates failure without direct-PDS fallback or local token refresh. |
| Logout and callback replay | Revoking one local account preserves the other; replayed/unknown callback state is rejected. |
| Process restart | A fresh Node process restores the saved forum session and makes an Agent request through HappyView. |

Blob, service-auth, and record tests prove request construction, **not** that a real PDS granted those permissions or accepted the requests.

## Raw SDK behavior and application handling

### 1. Application state is not interchangeable

HappyView's Node SDK uses the supplied `state` directly as the OAuth state and pending-transaction storage key.

The test starts two authorizations with the same supplied value. Both use the same OAuth state, and the second overwrites the first pending record.

atmoBB supplies a random opaque OAuth state and stores its return path or forum-connection context separately. The transaction is browser-bound, expires after ten minutes, and is consumed atomically. Personal login and forum authorization use separate credential stores.

### 2. Callback issuer is not checked locally

The SDK accepts a callback with a mismatched `iss` and proceeds to token exchange and registration. The synthetic token service returns the expected account, so this test demonstrates missing client-side validation, not an account takeover.

The atmoBB adapter checks the callback issuer against the authorization transaction and checks the token's account before registration. HappyView's independent token ownership check is not a substitute for these client-side checks.

### 3. Missing token scope uses the wrong fallback

When the token response omits `scope`, the Node SDK records its configured client-wide scope rather than the narrower scope requested for this authorization.

The test requests member permissions and observes member-plus-forum metadata after callback. This does **not** grant additional PDS permissions; it makes the SDK's stored/reported grant incorrect and can affect registration checks.

The atmoBB adapter uses a per-transaction SDK instance whose fallback scope is the requested scope. It preserves explicit server scopes.

### 4. PAR nonce challenges are not retried

The Node SDK sends a key-bound authorization request using `dpop_jkt`, but a synthetic `use_dpop_nonce` response from the pushed authorization request endpoint terminates login rather than obtaining a nonce-bound retry.

The atmoBB transport handles a PAR nonce challenge with one signed retry using the SDK's public signing API.

## Session refresh

The SDK retains an access token and private DPoP key locally, but not the refresh token. The runtime tests establish that `Agent` uses HappyView, including after a process restart.

HappyView's source implements refresh as follows:

1. HappyView looks up the incoming session by API client and DPoP key thumbprint.
2. It validates the supplied token's hash inside the signed proof, but does not compare the supplied token with the current stored PDS access token.
3. HappyView uses its encrypted stored credentials for the onward PDS request.
4. A recognized expired/invalid-token response triggers HappyView's refresh and persists the new token pair.

The registered signing key identifies the HappyView session, so the SDK token can authenticate SDK-to-HappyView requests independently of the refreshed PDS token. This describes the server implementation; the suite does not exercise server refresh.

Live PDS expiry, refresh-token rotation, and revocation are outside this suite's coverage.

Sources: [incoming DPoP authentication](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/auth/middleware.rs#L212-L264), [PDS retry and refresh](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/oauth/pds_write.rs#L272-L310), [persisting refreshed tokens](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/oauth/pds_write.rs#L846-L894).

## Native migration limitation

The supported Node/browser SDK registers credentials in `happyview_dpop_sessions`. Registration does not enqueue migration. The migration worker reads scopes and credentials from `happyview_oauth_sessions`, and native synchronization restores that same hosted-OAuth session type.

SDK-driven native PDS migration is unsupported. The application does not copy tokens between these stores, combine grants from different device sessions, or route member login through the dashboard callback.

Sources: [SDK registration](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/oauth/routes.rs#L411-L618), [migration scope lookup](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/jobs/native/migrate_space_repo.rs#L47-L74), [migration session retrieval](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/jobs/native/migrate_space_repo.rs#L224-L282), [native sync](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/spaces/native_sync.rs#L44-L76), [existing transport abstraction](https://github.com/gamesgamesgamesgamesgames/happyview/blob/cb3cd86ab0fb6db1f20c4f31dc02e3747608210f/src/repo/pds.rs#L13-L150).

## Coverage limits

Synthetic responses do not establish the following real-service behavior:

- Real member and separately connected forum-account consent, cancellation, wrong-account rejection, and browser-bound callback validation.
- Permission-set expansion and newly installed extension permissions against HappyView's configured client/lexicon registry.
- Record CRUD, image/font upload, and notification service auth through `serviceproxy` routing.
- PDS expiry/refresh/rotation, atmoBB process restart, and revocation.
- SDK-authorized `polyfill → migrating → native` migration, integrity verification, native writes, and sync after lost notifications.

The suite performs no live-account authorization or migration and changes no application configuration.
