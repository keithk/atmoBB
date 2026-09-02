# Features

Everything an atmobb forum does today. What I haven't built is listed at the [bottom](#not-built) so nobody promises it by accident.

## Posting

- **Threads and replies.** Members start threads from a board's composer and reply from the thread page. Both are records written straight to the author's own PDS; the page polls the appview until the post comes back through Jetstream, so you see your own post as soon as the network does.
- **Rich text.** A toolbar editor with bold, italic, underline, strikethrough, spoilers, links, blockquotes, and code blocks. Posts travel as a BBCode-lite wire format and are stored as structured `app.atmobb.richtext` blocks. I left out headings, lists, and horizontal rules. It's a forum post, not a manifesto.
- **Images.** Paste, drag, or pick a file (2 MB, any image type). Images upload to the author's PDS immediately and render lazily with alt text.
- **Spoilers.** Click-to-reveal inline spans, in the editor and in rendered posts.
- **Mentions.** `@handle` anywhere in a post resolves to a DID at write time and renders as a member link. Handles that don't resolve stay plain text.
- **Quote blocks.** Hand-written, or lifted from a post with its **quote** button, in which case the block carries a reference to the quoted record and renders with a "wrote:" line linking back to it.
- **Polls.** A thread can carry a poll: a question, 2 to 10 options, single or multiple choice, and an optional run time in days. Votes are `app.atmobb.poll.vote` records in each voter's repo, one per chosen option; retracting deletes them, and the appview tallies them per thread. Not available on members-only boards, whose threads live outside the public index.
- **Replying to a post.** Every post has **reply** and **quote** links. A reply made that way records which post it answers, and shows "replying to" with a link that jumps to it, even on another page. Threads stay flat and chronological; the links are the threading.
- **Edit and delete your own posts.** Reopen a post in the same editor, save, and the post is marked edited with the time. Deleting removes the record from your repo; deleting a thread takes its page with it, and other people's replies stay in their own repos, unlisted.

## Members and identity

- **atproto login, no local accounts.** Members sign in with any atproto account over OAuth. The consent screen requests a published permission set (`app.atmobb.authForum`) scoped to exactly the six collections atmobb writes.
- **One profile, every forum.** Display name, bio, avatar, signature, user title, pronouns, and website live in a single `app.atmobb.actor.profile` record in the member's own repo, so the same profile follows them to every atmobb forum.
- **Signatures.** Up to three blocks of text and images, phpBB style, rendered under every post, with a live preview in settings.
- **Avatars.** Upload an image (1 MB), or fall back to a generated monogram with a hue seeded from the DID. Blobs are fetched by resolving the DID's *current* PDS, so avatars survive migrations.
- **The avatar lab.** A built-in 100 × 100 forum-icon builder: crop and zoom a photo, rotate and skew it, pick frames, filters (Flash!, Faded, B&W, Pixel…), border and background colors, a text stamp, and sparkles. The finished icon is a real avatar blob, so it works on forums that never heard of the lab.
- **Avatars from anywhere.** The avatar is a plain blob on the profile record, so any app the member authorizes can write one. Set `ATMOBB_AVATAR_BUILDER_URL` to link a builder from profile settings.
- **Post counts, here and everywhere.** Every post rail shows the member's count on this forum and, when it's higher, their count across every indexed atmobb forum.
- **Rank ladders.** Each forum defines its own title-by-post-count ladder (up to 50 rungs) in its forum profile record; ranks show up in post rails, the member list, and hovercards.
- **Member profiles.** `/members/<handle>` shows bio, recent topics (linked to their origin forum), recent Bluesky posts, signature, per-forum activity across the network, and an "Elsewhere" panel that detects other atproto apps in their repo: WhiteWind, Linkat, PinkSea, Smoke Signal, Frontpage, and friends.
- **Hovercards.** Hover any member link for avatar, rank, both post counts, join date, and presence.
- **Who's online.** Members by DID, guests counted anonymously (salted hash, never identified), online/idle dots on avatars, and an all-time high-water mark on the home page. Very phpBB.

## Boards

- **Categories, boards, subforums.** Categories group boards on the index; boards take a description, an ordering, and optionally a parent for one level of nesting.
- **The index.** Boards by category with thread, reply, and last-post columns, forum stats (threads, posts, members, newest member), a hot-threads strip, and who's online.
- **Latest.** A cross-board feed of recently active threads, including federated peers.
- **Members-only boards** *(experimental, config-gated)*. Flip a board to members-only and new content goes into a Happyview permissioned space instead of public repos. Only approved members can read or write it, and everyone else gets a request-access form. Read the [warnings](private-boards.md) before enabling one. Space content lives only in Postgres, and I kept some things public.

## Across the atmosphere

- **Topic federation.** Give a board a topic slug and it merges thread streams with every board in the atmosphere sharing that slug, either open to all or restricted to an allowlist of forum DIDs. Merged threads carry a "via" label and link back to their origin forum's own site.
- **The directory and webring.** The appview tracks every atmobb forum it has seen, in founding order. That powers a forum directory and a real webring: `/ring/next`, `/ring/prev`, `/ring/random`.
- **Domain-verified forum identity.** Every deployment serves its forum DID at `/.well-known/atproto-did`, so the forum account can claim the site's domain as its handle with no DNS fiddling. Handle-as-domain is what makes cross-forum links and the webring work: `https://<forum-handle>` is the forum.
- **Cross-forum profiles and counts.** A member's profile page breaks their activity down per forum across the network, and atmosphere-wide post counts sum across every indexed forum.

## Moderation and staff

- **Staff grants.** Admins and moderators are `app.atmobb.forum.moderator` records in the forum's repo, managed by handle from the admin panel. A moderator can be limited to certain boards; admins always cover the whole forum. The last admin can't remove themselves.
- **A public, portable mod log.** Every action is an `app.atmobb.moderation.action` record in the forum's public repo, so anyone can audit it and any appview can index it.
- **Hide and unhide threads.** One button on any board row or thread page. Hiding one of the forum's own threads propagates to every forum that indexes it; hiding a federated thread only shapes the local view.
- **Lock and pin threads.** Locking stops new replies, and it's enforced when the thread is read: a reply written from another client after the lock doesn't show, though staff can still post a closing word. Pinned threads sit at the top of their own board. Both are the origin forum's call, not a federated peer's.
- **Bans and warnings.** From a member's profile, staff can warn them (a reason they'll see on their profile) or ban them, forum-wide or from one board, for a number of days or until lifted. A ban refuses new threads, replies, votes, and access requests in the app, and the appview drops anything the member posts inside the ban window from any other client. Posts from before the ban stay. Banned members see why on every page.
- **Block and unblock forums.** Drop another forum out of a board's merged stream, or mute it forum-wide in Latest.
- **Access queue.** Members-only boards get a request queue with approve and deny, filtered so already-members and re-asks after a denial don't pile up.
- **Undo.** Active hides, locks, pins, bans, and blocks are listed in the admin panel with one-click reversal.
- **Operator delisting.** An operator running a shared appview can delist a forum from every cross-forum surface (directory, webring, federation, member activity) with one database row, without touching the forum's records or its own site.

## Admin panel

Custom CSS never applies to `/admin`, so a broken theme is always repairable.

- **Profile.** Forum name, description, and rules (rendered at `/rules`).
- **Appearance.** Custom CSS and up to 12 uploaded WOFF/WOFF2 webfonts. See [theming](theming.md) for the cascade contract, tokens, and class hooks.
- **Boards.** Create, edit, delete, categorize, nest, reorder with up/down arrows, toggle members-only, with destructive-action confirmations where they're needed.
- **Staff.** Grant and revoke admin and moderator roles.
- **Topics.** Set a board's topic slug, choose open or allowlist federation, preview what a topic would merge with before committing, and browse every topic in the atmosphere.
- **Connection.** OAuth-connect the forum's own account. Whoever connects it first gets bootstrapped as admin; connecting the wrong account is detected and revoked.

Admin saves wait until the change is visible in the index before redirecting, so the panel never shows you stale state.

## Protocol plumbing

- **Your posts are yours.** Public threads, replies, memberships, and profiles are records in each author's own repo. The forum's repo holds the boards, categories, staff grants, and moderation actions. Delete your account and your posts are actually gone from your repo; move PDSes and everything follows you.
- **The forum is an atproto account too.** With a domain handle, a public repo, and a DID served at `/.well-known/atproto-did`.
- **Indexing.** [Happyview](happyview.md) consumes Jetstream, indexes the `app.atmobb.*` collections, and serves the forum's queries from Lua. A backfill script picks up records that predate the instance.
- **Published lexicons.** Schemas resolve from a dedicated authority account, so [self-hosters publish nothing](lexicons.md) and a personal-account migration can't take the namespace down.
- **Graceful degradation.** If the appview is down, pages still render in a degraded mode instead of erroring.
- **Open Graph cards.** Server-rendered PNG cards for the forum, threads, and member profiles, so every shared URL unfurls properly.

## Theming

- **Owner CSS wins without fighting.** All built-in styles sit in a low-priority cascade layer; plain unlayered CSS beats them with no `!important`. A documented token API (`--forum-*`, `--font-*`) and stable `atm-` class hooks are the contract. See [theming](theming.md).
- **Custom fonts.** Uploaded as blobs to the forum's repo, emitted as `@font-face` rules.

## Not built

I haven't built search, notifications, RSS, private messages, or reactions, and there's no schema for any of them either. Polls on members-only boards aren't built either, since votes are public records the space can't see.
