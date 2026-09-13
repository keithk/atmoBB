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

- **atproto login, no local accounts.** Members sign in with any atproto account over OAuth. The consent screen requests a published permission set (`app.atmobb.authForum`) scoped to exactly the seven collections atmobb writes, plus a separate `rpc` scope that lets the forum ask atmo.pub to deliver notifications.
- **One profile, every forum.** Display name, bio, avatar, signature, user title, pronouns, and website live in a single `app.atmobb.actor.profile` record in the member's own repo, so the same profile follows them to every atmobb forum.
- **Signatures.** Up to three blocks of text and images, phpBB style, rendered under every post, with a live preview in settings.
- **Avatars.** Upload an image (1 MB), or fall back to a generated monogram with a hue seeded from the DID. Blobs are fetched by resolving the DID's *current* PDS, so avatars survive migrations.
- **The userpic maker.** A built-in 100 × 100 forum-icon builder: crop and zoom a photo, then leave it plain or add a simple border. The finished icon is a real avatar blob, so it works on forums that never heard of the maker.
- **Avatars from anywhere.** The avatar is a plain blob on the profile record, so any app the member authorizes can write one. Set `ATMOBB_AVATAR_BUILDER_URL` to link a builder from profile settings.
- **Member profiles.** `/members/<handle>` shows bio, recent topics (linked to their origin forum), recent Bluesky posts, signature, per-forum activity across the network, and an "Elsewhere" panel that detects other atproto apps in their repo: WhiteWind, Linkat, PinkSea, Smoke Signal, Frontpage, and friends.
- **Hovercards.** Hover any member link for avatar, worn stamps, "here since", and presence.
- **Who's online.** Members by DID, guests counted anonymously (salted hash, never identified), online/idle dots on avatars, and an all-time high-water mark on the home page. Very phpBB.

### Stamps

There are no post counts and no rank ladders. A stamp says where a member has been or when they arrived. The post rail, hovercards, the members list, and profiles show the stamps a member wears and the month their atmobb profile was created, as "here since".

- **A stamp is a record.** `app.atmobb.forum.stamp`, in the forum's repo: a name of up to 24 graphemes, a look, and one trigger. The look is a background color, an ink color, and a shape (stamp, pill, ticket, or pixel); it can't take free CSS or an image. The trigger is one of: first post in a given board, first post on this forum, profile created before a date, arrived by invite, application, or founding, or given by hand.
- **Authoring.** Admin → Stamps, with a preview on a light and a dark theme, a warning when ink on background falls under 3:1, and a retire button that deletes the record after a confirmation. A first-post stamp whose board has been deleted reads as retired until it's pointed at another board or retired for good.
- **Retroactive.** Triggers are matched when a page is read, against first posts, membership windows, profile dates, and by-hand awards already in the index, so a stamp authored today goes to everyone who already qualifies, with nothing to backfill.
- **Firsts stick.** The appview records a member's first served post per board and per forum as it arrives and never takes the row back, so deleting the post keeps the stamp. Members-only boards never fire a first-post stamp; their posts are outside the public index.
- **The defaults.** A forum that authors nothing still hands out an arrival stamp ("brought in by @sponsor" for invite and application, "original member" for founding) and one first-post stamp per board, in the board's color. A switch on Admin → Stamps hides both; "here since" always shows.
- **The network set.** Two stamps every forum on an appview offers: "first light" for a first post anywhere that appview indexes, and "early days" for a profile created before 2026-10-01. A hosted tenant gets the shared appview's set; a self-hosted appview issues its own.
- **Wearing.** Every stamp a member holds sits in a tray at `/settings/stamps`, and they wear up to three of them, in their own order. The choice is saved as `wearing` on their `app.atmobb.forum.membership` record, so it's per forum and leaves with the declaration. A member who never chose wears their three newest defaults.
- **By hand.** Forum-wide staff give and revoke by-hand stamps from the member's profile page. Each is an `awardStamp` or `revokeStamp` action in the mod log, naming the stamp and the staffer who did it.

## Membership

Joining a forum is an `app.atmobb.forum.membership` record in the member's own repo. On an open forum, the default, that declaration is the whole story. Gate the forum and it takes two things to post: the forum has to have accepted you, and you have to have declared.

- **Three join modes.** Open, apply, or invite, set on Admin → Members with a prompt for applicants, an invite cap (default 3 open invites per member), and an invite lifetime (default 14 days). The policy is a `membership` object on the forum's profile record. Gated modes are only offered when the index can answer the membership query, so a forum can't gate itself on an appview that wouldn't enforce it.
- **Reading stays public.** Non-members read everything on a gated forum. The composer, reply, quote, vote, and private-board request controls are replaced by a join notice. Membership gates writing, not reading.
- **Acceptances are moderation actions.** Being accepted is an `acceptMember` action in the forum's public repo, carrying who sponsored you and how you came in (`invite`, `application`, or `founding`). Removal is `revokeMember`. Both are in the mod log like everything else.
- **Gating keeps the past.** Flipping open → gated shows how many people will be grandfathered and asks you to confirm. It then writes founding `acceptMember` actions for everyone already here (the declared roster, the staff, and thread authors, last repliers, and up to five participants per thread from the latest feed, minus anyone under a forum-wide ban), then a `gateForum` action, then the profile flip, all stamped with one timestamp; a failure part-way leaves the forum open, and trying again finishes the job. A quiet replier deep in a long thread who never declared membership can be missed and has to be invited again. Posts written while the forum was open are always served, whoever wrote them; only posts written during a gated period are held to the author's standing at the time they posted. Opening the forum again is `openForum`, and the acceptances stay for the next time.
- **Applying.** On an apply-mode forum, `/apply` asks the one question the forum set. The answer is an `app.atmobb.forum.accessRequest` record in the applicant's own repo, so it's public. Staff see the queue on Admin → Members and can approve (the approving staffer becomes the sponsor), deny, or hold it, with a link to the applicant's Bluesky profile for a look around. A denied applicant can apply again.
- **Invites.** On an invite-mode forum, members mint invite links from `/settings/invites`, up to the cap, and can withdraw their own. Staff mint from Admin → Members. `/join/<token>` shows who invited you and asks you to confirm. A refusal for any reason (already a member, banned, expired link) never spends the invite. Invite links are the only piece of this that isn't a public record: they live in a file in the forum's data directory, because the token in the link is the whole secret.
- **The roster.** Admin → Members lists every accepted member with their sponsor. Staff can remove a member; a staffer has to leave staff first. A forum-wide ban also revokes membership, and lifting the ban doesn't restore it. Leaving is still deleting your own declaration, and the forum's acceptance survives, so coming back is just declaring again.
- **Finish joining.** An accepted account that hasn't declared yet gets a one-click "Finish joining" button, which writes the declaration.

## Boards

- **Categories, boards, subforums.** Categories group boards on the index; boards take a description, an ordering, and optionally a parent for one level of nesting.
- **The index.** Boards by category with thread, reply, and last-post columns, forum stats (threads, posts, members, newest member), a hot-threads strip, and who's online.
- **Latest.** A cross-board feed of recently active threads, including federated peers.
- **Members-only boards** *(experimental, config-gated)*. Flip a board to members-only and new content goes into a Happyview permissioned space instead of public repos. Only approved members can read or write it, and everyone else gets a request-access form. Read the [warnings](private-boards.md) before enabling one. Space content lives only in Postgres, and I kept some things public.

## Across the atmosphere

- **Topic federation.** Give a board a topic slug and it merges thread streams with every board in the atmosphere sharing that slug, either open to all or restricted to an allowlist of forum DIDs. Merged threads carry a "via" label and link back to their origin forum's own site.
- **The directory and webring.** The appview tracks every atmobb forum it has seen, in founding order. That powers a forum directory and a real webring: `/ring/next`, `/ring/prev`, `/ring/random`.
- **Domain-verified forum identity.** Every deployment serves its forum DID at `/.well-known/atproto-did`, so the forum account can claim the site's domain as its handle with no DNS fiddling. Handle-as-domain is what makes cross-forum links and the webring work: `https://<forum-handle>` is the forum.
- **Cross-forum profiles.** A member's profile page breaks their activity down per forum across the network. Stamps stay with the forum that issued them, except the network set, which reads the same on every forum the appview serves.

## Notifications

- **Delivered by atmo.pub.** Members turn notifications on from settings, approve the forum once at [atmo.pub](https://atmo.pub), and pick their channels there: web push, email, Telegram, Bluesky DM, or a webhook. The forum sends; atmo.pub delivers. I didn't build any of the channels myself.
- **What pings you.** A reply in a thread you started, a reply or quote aimed at one of your posts, an @mention, and a new thread in a board you watch. One alert per post, even when several apply. Only posts written through this forum's site trigger them; replies that arrive through topic federation or another client don't, yet.
- **The prompt.** The home page and the thread page after your first post ask once whether you want to hear back. Say no and it never asks again; the switch stays in settings.
- **The bell.** Opted-in members get an unread count in the masthead and a page listing recent alerts, fed by the forum's own record of what it sent. Reading one on atmo.pub doesn't clear it here, and vice versa. That page also carries the atmo.pub panel, so a member who lands there with notifications off can read what the relay is and connect from the spot.
- **Watching boards.** Watch and unwatch from the board page. A watch is an `app.atmobb.forum.watch` record in your own repo, so it follows you like a membership does.
- **Each forum is its own sender.** A forum shows up in atmo.pub under its own name, with a key it generates on first boot. A member on three atmobb forums approves three apps.
- **Members-only boards stay quiet.** An alert about a private board says only that something happened and links to it. No title, no text, no name, and nothing goes to anyone who can't read the board.

## Moderation and staff

- **Staff grants.** Admins and moderators are `app.atmobb.forum.moderator` records in the forum's repo, managed by handle from the admin panel. A moderator can be limited to certain boards; admins always cover the whole forum. The last admin can't remove themselves.
- **A public, portable mod log.** Every action is an `app.atmobb.moderation.action` record in the forum's public repo, so anyone can audit it and any appview can index it.
- **Hide and unhide threads.** One button on any board row or thread page. Hiding one of the forum's own threads propagates to every forum that indexes it; hiding a federated thread only shapes the local view.
- **Lock and pin threads.** Locking stops new replies, and it's enforced when the thread is read: a reply written from another client after the lock doesn't show, though staff can still post a closing word. Pinned threads sit at the top of their own board. Both are the origin forum's call, not a federated peer's.
- **Bans and warnings.** From a member's profile, staff can warn them (a reason they'll see on their profile) or ban them, forum-wide or from one board, for a number of days or until lifted. A ban refuses new threads, replies, votes, and access requests in the app, and the appview drops anything the member posts inside the ban window from any other client. Posts from before the ban stay. Banned members see why on every page. On a gated forum a forum-wide ban also revokes membership, and lifting it doesn't put the member back.
- **Block and unblock forums.** Drop another forum out of a board's merged stream, or mute it forum-wide in Latest.
- **Access queue.** Members-only boards get a request queue on Admin → Members with approve and deny, filtered so already-members and re-asks after a denial don't pile up. On a gated forum only members can ask.
- **Undo.** Active hides, locks, pins, bans, and blocks are listed on Admin → Topics with one-click reversal. Membership decisions aren't in that list; they're reversed from the Members page.
- **Operator delisting.** An operator running a shared appview can delist a forum from every cross-forum surface (directory, webring, federation, member activity) with one database row, without touching the forum's records or its own site.

## Admin panel

Custom CSS never applies to `/admin`, so a broken theme is always repairable.

- **Profile.** Forum name, a plain tagline (also the search and social description), an optional rich intro shown in the home page hero, and rules (rendered at `/rules`).
- **Appearance.** Custom CSS and up to 12 uploaded WOFF/WOFF2 webfonts. See [theming](theming.md) for the cascade contract, tokens, and class hooks.
- **Boards.** Create, edit, delete, categorize, nest, reorder with up/down arrows, toggle members-only, with destructive-action confirmations where they're needed.
- **Staff.** Grant and revoke admin and moderator roles.
- **Members.** Join mode, application prompt, invite cap and lifetime, the application queue, staff invites, the members-only board request queue, and the roster with removal.
- **Stamps.** Author, preview, and retire the forum's stamps, and hide the default board and arrival stamps.
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

I haven't built search, RSS, private messages, or reactions, and there's no schema for any of them either. Polls on members-only boards aren't built either, since votes are public records the space can't see. Notifications exist through atmo.pub but don't yet cover replies from federated peers or other clients, watching a single thread, moderation notices, or membership decisions. Membership has no private variant: applications, acceptances, sponsors, and removals are all public records.
