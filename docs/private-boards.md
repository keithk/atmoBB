# Members-only boards

Boards are public by default. Threads and replies live in the authors' repos, so anyone watching the firehose can index them. Flip a board to members-only and new content goes into a Happyview **permissioned space** instead, where only space members can read or write. Threads that were already public stay public. They don't move.

> [!CAUTION]
> Happyview permissioned spaces are experimental. Their content lives only in the forum's Postgres database and cannot be recovered from the AT Protocol network. Set up and test off-server backups before enabling them.

Each private board gets one space keyed by its rkey: `at://<forum-did>/space/app.atmobb.forum.privateBoard/<board-rkey>`. The forum account is the authority, membership controls access, and the public board record points at the space through its `access` field.

## What's private and what isn't

Thread and reply records, titles and authorship included, stay in the Happyview instance and are only served to space members. That's access control, not encryption. The forum account is the space authority, and anyone with the Happyview session secret or database access can read the content.

I kept these public:

- The board's existence, name, and description, because that record sits in the forum's public repo.
- Access requests, which are `app.atmobb.forum.accessRequest` records in the requesters' own public repos.
- Approvals and denials, which are `app.atmobb.moderation.action` records in the forum's public repo.

> [!IMPORTANT]
> If you need the membership list itself to be secret, I didn't build that, and this design won't give it to you. Board names, access requests, and approval decisions are all public records by design. Read the list above before you promise anyone privacy you can't deliver.

Two things I left out of members-only boards:

- **Images.** The composer stores images as blobs on the author's PDS, and a PDS only serves a blob while a record in that repo references it. A space record isn't in the repo, so the image would be either public or gone. The composer hides the image button on these boards and the server refuses image blocks in space posts (`assertNoImages` in `src/lib/server/pds.ts`).
- **Polls.** Votes are public records that name the thread they belong to.

## Reading and writing

Space content bypasses the public index entirely. `src/lib/server/space-read.ts` assembles a private board by listing member repos and fetching their thread and reply records as the viewer. Author profiles still come from the public index. Post counts on a private board only count that board, because the public counters can't see space records.

Before creating a thread, the app asks Happyview whether the board has a space (`getBoardAccess` in `src/lib/server/appview.ts`). That check fails closed. Only a confirmed "no such space" answer lets a public write through, and any other error blocks the write. I'd rather refuse a post than have private content quietly land in someone's public repo. Replies go wherever their thread went.

Non-members get a locked board and a request-access form. Space thread URLs return 403.

## How the app authenticates to spaces

Happyview checks space membership through its session cookie. The app shares Happyview's `SESSION_SECRET` and uses it to mint a `happyview_session` cookie for whichever DID is acting (`src/lib/server/happyview-session.ts`): the member for content access, the forum account for administration. If those two secrets don't match, every private-board request fails.

The cookie is a signed DID with no expiry and no binding to a client. Whoever holds the secret can act as any DID on the instance, so the secret is the whole boundary. That has two consequences:

- The app only ever mints a cookie for the DID behind a verified `atmobb_session`, for the forum account, or for a board's own forum when checking whether its space exists. A forged app session would therefore be a forged space session too, which is why the app's own cookie secret matters as much as Happyview's.
- In production the app refuses to start unless `ATMOBB_COOKIE_SECRET` is at least 32 bytes and not a placeholder, and applies the same test to `HAPPYVIEW_SESSION_SECRET` when it's set (`src/lib/server/secrets.ts`). Happyview enforces the same rule on its side.

## The join flow

1. A non-member submits the request form, with an optional note. This writes a public `accessRequest` record to their repo.
2. The request shows up on `/admin/boards`. Requests from current members, and requests with a denial or revocation decided after them, are filtered out.
3. **Approve** grants space write access and records a `grantAccess` moderation action.
4. **Deny** records a `denyAccess` action and changes nothing about space membership. They can ask again: a new request replaces the old record with a fresh timestamp, which reopens it in the queue.

## Leaving and being removed

Membership is what gates the board, so anything meant to keep someone out has to touch it. Bans alone only stop writes, and space reads never see them.

- **Remove** on `/admin/boards` takes a member out of a board's space and records a `revokeAccess` action. Their posts stay in the space. They can ask again.
- **Banning** a member, from a board or the whole forum, also removes them from every space the ban covers. Lifting the ban doesn't put them back; they request access again.
- Space writes check bans strictly. If the appview can't confirm a member's standing, I refuse the post rather than let it through, because nothing downstream would catch it.

## Board lifecycle

Making a board members-only, whether it's new or was public, creates its space and updates the board's `access` field. Existing public threads stay public. Only new content uses the space.

> [!CAUTION]
> **Turning a private board public deletes its space and every thread and reply in it.** Deleting the board does the same thing.
>
> Nothing gets migrated out to public repos first, and there is no export. The admin UI makes you confirm, and that confirmation is the only thing standing between you and permanently destroying every private conversation on that board.

## Running it in production

Once you've finished the standard [self-hosting setup](self-hosting.md):

1. Spaces are off by default in Happyview. Turn them on:

   ```sh
   HV=http://127.0.0.1:3000
   curl --fail-with-body --silent --show-error -X PUT "$HV/admin/settings/feature.spaces_enabled" \
     -H "Authorization: Bearer $HAPPYVIEW_API_KEY" -H "Content-Type: application/json" \
     -d '{"value": "true"}'
   ```

2. Set `HAPPYVIEW_SESSION_SECRET` on the app to the same value as the Happyview container's `SESSION_SECRET`.

Without that variable, a production app hides the members-only option entirely and rejects attempts to set it. I'd rather the option not exist than let an admin create a board the app can never open.

`appview/setup.sh` registers the `accessRequest` lexicon the moderation queue depends on.
