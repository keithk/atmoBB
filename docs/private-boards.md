# Members-only boards

Boards are public by default. Threads and replies live in the authors' repos, so anyone watching the firehose can index them. On a members-only board, new content goes into a HappyView **permissioned space** instead. Space membership controls access. Public threads stay public when a board becomes members-only; the toggle does not move them.

> [!CAUTION]
> Happyview permissioned spaces are experimental. Their content lives only in the forum's Postgres database and cannot be recovered from the AT Protocol network. Set up and test off-server backups before enabling them.

Each private board gets one space. Keys hash the forum DID and board rkey because keys are unique per space type across the instance. The returned URI may use HappyView's published service DID as its authority; the forum account is the creator and administrator. The public board record stores that URI in `access`. Lookup also recognizes spaces keyed by the bare board rkey and does not infer authority from the creator.

## What's private and what isn't

Polyfill thread and reply records, titles and authorship included, stay in the HappyView instance. atmoBB serves them only to members whose `read` flag is true. That's access control, not encryption. Anyone with the HappyView session secret or database access can read the content.

HappyView 2.16's direct `listRecords` and `listRepos` endpoints return data to members with `read=false`, even though `getRecord` denies them. atmoBB independently checks read permission before each record/repo read. To revoke access at the host, **remove the member**, rather than merely setting `read=false`; removal denies all three endpoints. The application guard does not protect requests made directly to HappyView. See the [space contract tests](../appview/tests/README.md).

These records are public:

- The board's existence, name, and description, because that record sits in the forum's public repo.
- Access requests, which are `app.atmobb.forum.accessRequest` records in the requesters' own public repos.
- Approvals and denials, which are `app.atmobb.moderation.action` records in the forum's public repo.

> [!IMPORTANT]
> This design does not provide a secret membership list. Board names, access requests, and approval decisions are public records. Account for that disclosure before promising privacy to members.

Members-only boards do not support:

- **Images.** The composer stores images as blobs on the author's PDS, and a PDS only serves a blob while a record in that repo references it. A space record isn't in the repo, so the image would be either public or gone. The composer hides the image button on these boards and the server refuses image blocks in space posts (`assertNoImages` in `src/lib/server/pds.ts`).
- **Polls.** Votes are public records that name the thread they belong to.

## Notifications

A members-only post still notifies the people it touches, but the alert that leaves the forum is bare: which kind of event happened, that it was on a members-only board, and a link through the forum's own notifications page. No title, no text, no author, no board name, and no DID anywhere in the payload, because atmo.pub forwards alerts to email and chat apps I don't control. Only current members of the space get one at all. If the appview can't confirm membership when a post lands, nobody is alerted for that post. The bell inside the forum shows the full title and text as usual.

## Reading and writing

Space content bypasses the public index entirely. `src/lib/server/space-read.ts` reads every writer/record page and requests `includeValues=true`, avoiding an extra fetch for each record. Missing inline values use an authorized record fetch. Author profiles still come from the public index. Private counts only cover that board.

Before creating a thread, the app reads the authoritative board record and the creator's complete HappyView space inventory (`getBoardAccess` in `src/lib/server/appview.ts`). It never guesses the authority DID or treats an endpoint's 404 as proof of public access. A missing board, unavailable referenced space, incomplete inventory, or ambiguous match blocks the write. Local privacy changes and new-thread writes share an in-process lock. Replies go wherever their thread went.

Non-members get a locked board and a request-access form. Private thread pages redirect non-members to that board without reading the conversation.

## How the app authenticates to spaces

Happyview checks space membership through its session cookie. The app shares Happyview's `SESSION_SECRET` and uses it to mint a `happyview_session` cookie for whichever DID is acting (`src/lib/server/happyview-session.ts`): the member for content access, the forum account for administration. If those two secrets don't match, every private-board request fails.

This is internal server-to-server authentication, not a second user login. Users sign in through the HappyView Node SDK. PDSes without `space:` grants still need this trusted first-party path for polyfill content; those internal cookies are never sent to the browser.

The cookie is a signed DID with no expiry and no binding to a client. Whoever holds the secret can act as any DID on the instance, so the secret is the whole boundary. That has two consequences:

- The app only ever mints a cookie for the DID behind a verified `atmobb_hv_session`, for the forum account, or for a board's own forum when checking its space inventory. A forged app session would therefore be a forged space session too, which is why the app's own cookie secret matters as much as HappyView's.
- In production the app refuses to start unless `ATMOBB_COOKIE_SECRET` is at least 32 bytes and not a placeholder, and applies the same test to `HAPPYVIEW_SESSION_SECRET` when it's set (`src/lib/server/secrets.ts`). Happyview enforces the same rule on its side.

## The join flow

1. A non-member submits the request form, with an optional note. This writes a public `accessRequest` record to their repo.
2. The request shows up on Admin → Members. Requests from current members, and requests with a denial or revocation decided after them, are filtered out.
3. **Approve** grants both read and write access with `putMember` and records a `grantAccess` moderation action.
4. **Deny** records a `denyAccess` action and changes nothing about space membership. They can ask again: a new request replaces the old record with a fresh timestamp, which reopens it in the queue.

On a gated forum ([membership](features.md#membership) in apply or invite mode), only forum members can request a board. Everyone else sees the join notice where the request form would be. The same `accessRequest` record type carries forum applications, with a `forum` field instead of `board`, and Admin → Members shows the two queues side by side.

## Leaving and being removed

Membership is what gates the board, so anything meant to keep someone out has to touch it. Bans alone only stop writes, and space reads never see them.

- **Remove** on Admin → Members takes a member out of a board's space and records a `revokeAccess` action. Their posts stay in the space. They can ask again.
- **Banning** a member, from a board or the whole forum, also removes them from every space the ban covers. Lifting the ban doesn't put them back; they request access again.
- Space writes check bans strictly. If the appview can't confirm a member's standing, I refuse the post rather than let it through, because nothing downstream would catch it.

## Board lifecycle

New members-only boards create the space first and include `access` in the initial board record, so there is no briefly public board. Existing public threads stay public when a board changes access. Uncertain publication failures preserve the space and report recovery instructions instead of silently discarding possible private content.

> [!CAUTION]
> **Turning a private board public deletes its space and every thread and reply in it.** Deleting the board does the same thing.
>
> Nothing gets migrated out to public repos first, and there is no export. The admin UI makes you confirm, and that confirmation is the only thing standing between you and permanently destroying every private conversation on that board.

## Running it in production

Once you've finished the standard [self-hosting setup](self-hosting.md):

1. `appview/setup.sh` enables spaces and HappyView's PDS-migration feature flag.
2. Set `HAPPYVIEW_SESSION_SECRET` on the app to the same value as the HappyView container's `SESSION_SECRET`.
3. Configure the public OAuth client, sign in, and connect the forum account through **Admin → Connection**.

The migration flag is enabled by default, but HappyView 2.16's migration worker does not consume SDK sessions. SDK-driven native migration and recovery of polyfill data from the network are unsupported. Keep tested database backups; the app does not export private conversations or republish them under another account.

Without that variable, a production app hides the members-only option entirely and rejects attempts to set it. I'd rather the option not exist than let an admin create a board the app can never open.

`appview/setup.sh` registers the `accessRequest` lexicon the moderation queue depends on.
