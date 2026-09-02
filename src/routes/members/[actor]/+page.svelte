<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import RankBadge from '$lib/components/RankBadge.svelte';
  import Card from '$lib/components/Card.svelte';
  import { relTime } from '$lib/reltime';
  import { threadPath } from '$lib/appview-paths';
  import RichText from '$lib/components/RichText.svelte';
  import { page } from '$app/state';

  let { data, form } = $props();

  const staff = $derived(!!page.data.staffRole);
  const saved = $derived(page.url.searchParams.has('saved'));
  const pending = $derived(page.url.searchParams.has('pending'));
  const boardName = (uri?: string) => (uri ? data.boards.find((b) => b.uri === uri)?.name ?? 'one board' : 'whole forum');
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '');

  const m = $derived(data.member);
  const p = $derived(data.member.profile);
  const name = $derived(p?.displayName ?? m.handle);
  const local = $derived(m.activity.local);
  const global = $derived(m.activity.global);
  const joined = $derived(
    p?.createdAt ? new Date(p.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null,
  );
  const presenceLabel = $derived(
    m.presence === 'online'
      ? 'Online now'
      : m.presence === 'idle'
        ? 'Idle'
        : global.lastActive
          ? `Last seen ${relTime(global.lastActive)}`
          : null,
  );
  const forumName = $derived(page.data.forum?.name ?? 'this forum');
  const sig = $derived(p?.signature ?? []);
</script>

<nav class="atm-crumbs atm-crumbs--spaced">
  <a href="/members">members</a><span class="atm-crumbs__sep">›</span>
  <span class="atm-crumbs__current">@{m.handle}</span>
</nav>

<article class="profile">
  <header class="cover">
    <Avatar seed={m.did} profile={p} size={96} presence={m.presence} ring alt={name} />
    <div class="cover__id">
      <h1 class="cover__name">{name}</h1>
      <code class="cover__handle">@{m.handle}</code>
      <div class="cover__meta">
        {#if joined}<span>Joined {joined}</span>{/if}
        {#if local.posts > 0}
          {#if joined}<span aria-hidden="true">·</span>{/if}
          <span><b>{local.posts.toLocaleString()}</b> posts on {forumName}</span>
        {/if}
        {#if global.posts > 0}
          {#if joined || local.posts > 0}<span aria-hidden="true">·</span>{/if}
          <span><b>{global.posts.toLocaleString()}</b> public posts across atmobb</span>
        {/if}
        {#if presenceLabel}
          {#if joined || local.posts > 0 || global.posts > 0}<span aria-hidden="true">·</span>{/if}
          <span class="atm-presence atm-presence--{m.presence}">{presenceLabel}</span>
        {/if}
      </div>
    </div>
    <div class="cover__actions">
      {#if data.isYou}
        <a class="atm-btn atm-btn--secondary" href="/settings/profile">Change avatar</a>
        <a class="atm-btn atm-btn--primary" href="/settings/profile">Edit profile</a>
      {:else if m.elsewhere.bsky}
        <a class="atm-btn atm-btn--secondary" href="https://bsky.app/profile/{m.elsewhere.bsky.handle}" target="_blank" rel="noopener">🦋 View on Bluesky</a>
      {/if}
    </div>
  </header>

  <div class="grid">
    <div class="col">
      {#if data.standing}
        <Card title="Standing">
          {#if pending}
            <p class="atm-ok">Saved. The change is taking a few extra seconds to show up here.</p>
          {:else if saved}
            <p class="atm-ok">Saved.</p>
          {/if}
          {#if form?.message}<p class="atm-err">{form.message}</p>{/if}
          {#if data.standing.bans.length}
            <ul class="standing__list">
              {#each data.standing.bans as ban (ban.uri)}
                <li class="standing__item">
                  <span class="atm-chip atm-chip--danger">banned</span>
                  <span>{boardName(ban.board)} · since {day(ban.since)}{ban.until ? ` · until ${day(ban.until)}` : ''}</span>
                  {#if ban.reason}<span class="standing__reason">{ban.reason}</span>{/if}
                  {#if staff}
                    <form method="POST" action="?/unban">
                      <input type="hidden" name="uri" value={ban.uri} />
                      <button class="atm-btn atm-btn--ghost atm-btn--sm">lift ban</button>
                    </form>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if data.standing.warnings.length}
            <ul class="standing__list">
              {#each data.standing.warnings as w (w.uri)}
                <li class="standing__item">
                  <span class="atm-chip">warning</span>
                  <span>{day(w.createdAt)}{w.board ? ` · ${boardName(w.board)}` : ''}</span>
                  {#if w.reason}<span class="standing__reason">{w.reason}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if !data.standing.bans.length && !data.standing.warnings.length}
            <p class="atm-empty atm-empty--bare">In good standing.</p>
          {/if}
          {#if staff && !data.isYou}
            <details class="standing__act">
              <summary>Warn</summary>
              <form class="standing__form" method="POST" action="?/warn">
                <textarea class="atm-input" name="reason" rows="2" required maxlength="1000" placeholder="What the warning is for"></textarea>
                <select class="atm-select" name="board">
                  <option value="">whole forum</option>
                  {#each data.boards as b}<option value={b.uri}>{b.name}</option>{/each}
                </select>
                <button class="atm-btn atm-btn--sm">record warning</button>
              </form>
            </details>
            <details class="standing__act">
              <summary>Ban</summary>
              <form class="standing__form" method="POST" action="?/ban">
                <select class="atm-select" name="board">
                  <option value="">whole forum</option>
                  {#each data.boards as b}<option value={b.uri}>{b.name}</option>{/each}
                </select>
                <label class="standing__row">for <input class="atm-input standing__days" type="number" name="days" min="0" max="3650" placeholder="∞" /> days</label>
                <textarea class="atm-input" name="reason" rows="2" maxlength="1000" placeholder="Reason (they'll see it)"></textarea>
                <button class="atm-btn atm-btn--sm atm-btn--danger">ban</button>
              </form>
            </details>
          {/if}
        </Card>
      {/if}
      <Card title="About">
        {#if p?.description}
          <p class="about">{p.description}</p>
        {:else}
          <p class="muted">No bio yet.</p>
        {/if}
      </Card>

      {#if m.activity.recentThreads.length}
        <Card title="Recent topics across atmobb">
          <ul class="posts">
            {#each m.activity.recentThreads as t}
              {@const site = t.forum.did === data.forumDid ? null : data.forumSites[t.forum.did]}
              <li>
                <span class="atm-eyebrow">
                  {t.forum.name ?? t.forum.did.slice(8, 24)}{#if t.boardName}<span aria-hidden="true"> · </span>{t.boardName}{/if}
                </span>
                <a class="posts__title" href={site ? `${site}${threadPath(t.uri)}` : threadPath(t.uri)}>{t.title}</a>
                <span class="posts__meta">
                  {relTime(t.createdAt)} · {t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'}
                </span>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      {#if m.elsewhere.posts.length}
        <Card title="Recent on Bluesky">
          <ul class="bposts">
            {#each m.elsewhere.posts as post}
              <li>
                <a class="bposts__text" href={post.url} target="_blank" rel="noopener">{post.text}</a>
                <span class="bposts__meta">
                  {relTime(post.createdAt)}
                  {#if post.replyCount}<span aria-hidden="true">·</span> {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}{/if}
                  {#if post.likeCount}<span aria-hidden="true">·</span> {post.likeCount} {post.likeCount === 1 ? 'like' : 'likes'}{/if}
                </span>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      {#if sig.length}
        <Card title="Signature">
          <p class="muted sig-note">This signature appears on posts across atmobb forums.</p>
          <div class="atm-sig sig">
            <RichText body={sig} />
          </div>
        </Card>
      {/if}
    </div>

    <aside class="col col--rail">
      {#if local.posts > 0}
        <Card title={forumName}>
          <div class="standing">
            <RankBadge ranks={data.ranks} posts={local.posts} />
            <div class="standing__stats">
              <span><b>{local.posts.toLocaleString()}</b> posts</span>
              <span><b>{local.topics.toLocaleString()}</b> topics</span>
              <span><b>{local.replies.toLocaleString()}</b> replies</span>
            </div>
            {#if local.lastActive}
              <span class="standing__seen">active {relTime(local.lastActive)}</span>
            {/if}
          </div>
        </Card>
      {:else}
        <Card title={forumName}>
          <p class="muted">
            {data.isYou ? "You haven't" : `${name} hasn't`} made any public posts on {forumName} yet.
            This atmosphere profile is shared across forums.
          </p>
        </Card>
      {/if}

      {#if global.posts > 0}
        <Card title="Across atmobb">
          <div class="network-stats">
            <div><b>{global.posts.toLocaleString()}</b><span>posts</span></div>
            <div><b>{global.topics.toLocaleString()}</b><span>topics</span></div>
            <div><b>{global.replies.toLocaleString()}</b><span>replies</span></div>
            <div><b>{global.forums.toLocaleString()}</b><span>public {global.forums === 1 ? 'forum' : 'forums'}</span></div>
          </div>
          <ul class="forum-activity">
            {#each m.activity.forums as forum}
              <li>
                <span class="forum-activity__name">
                  {forum.name ?? forum.did.slice(8, 24)}
                  {#if forum.did === data.forumDid}<span class="atm-chip">here</span>{/if}
                </span>
                <span class="forum-activity__count">
                  {forum.posts.toLocaleString()} {forum.posts === 1 ? 'post' : 'posts'}
                  <small>
                    {forum.topics.toLocaleString()} {forum.topics === 1 ? 'topic' : 'topics'} ·
                    {forum.replies.toLocaleString()} {forum.replies === 1 ? 'reply' : 'replies'}
                  </small>
                </span>
              </li>
            {/each}
          </ul>
          <p class="muted public-note">Public forums only.</p>
        </Card>
      {/if}

      {#if m.elsewhere.bsky || m.elsewhere.apps.length}
        <Card title="Elsewhere">
          <ul class="elsewhere">
            {#if m.elsewhere.bsky}
              <li>
                <span class="elsewhere__icon" aria-hidden="true">🦋</span>
                <a href="https://bsky.app/profile/{m.elsewhere.bsky.handle}" target="_blank" rel="noopener">
                  <b>Bluesky</b> <span class="elsewhere__sub">@{m.elsewhere.bsky.handle}</span>
                </a>
              </li>
            {/if}
            {#each m.elsewhere.apps as app}
              <li>
                <span class="elsewhere__icon" aria-hidden="true">{app.icon}</span>
                {#if app.url}
                  <a href={app.url} target="_blank" rel="noopener"><b>{app.label}</b></a>
                {:else}
                  <span><b>{app.label}</b></span>
                {/if}
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      <Card title="Identity">
        <div class="identity">
          {#if p?.pronouns}<div class="identity__row"><span class="identity__k">Pronouns</span><span>{p.pronouns}</span></div>{/if}
          {#if p?.website}<div class="identity__row"><span class="identity__k">Website</span><a href={p.website} target="_blank" rel="noopener">{p.website.replace(/^https?:\/\//, '')}</a></div>{/if}
          <code class="identity__did">{m.did}</code>
        </div>
      </Card>
    </aside>
  </div>
</article>

<style>
  .standing__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .standing__item { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font: var(--type-meta); color: var(--forum-ink-soft); }
  .standing__reason { flex-basis: 100%; color: var(--forum-ink); }
  .standing__act { margin-top: var(--space-3); }
  .standing__act summary { cursor: pointer; font: var(--type-meta); color: var(--forum-ink-soft); }
  .standing__form { display: grid; gap: var(--space-2); margin-top: var(--space-2); }
  .standing__row { display: flex; align-items: center; gap: var(--space-2); font: var(--type-meta); color: var(--forum-ink-soft); }
  .standing__days { width: 6ch; }

  @layer atmobb {
  .profile {
    border: var(--border-hair) solid var(--forum-edge);
    border-radius: var(--radius-lg);
    background: var(--forum-surface);
    box-shadow: inset 0 1px 0 var(--forum-bevel), var(--shadow-sm);
    overflow: hidden;
  }

  .cover {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--forum-surface);
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .cover__id { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
  .cover__name { font: var(--type-page-title); color: var(--forum-ink); margin: 0; }
  .cover__handle { font: var(--type-handle); color: var(--forum-ink-soft); }
  .cover__meta {
    display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);
    margin-top: var(--space-1);
    font: var(--type-meta); color: var(--forum-ink-soft);
  }
  .cover__meta b { color: var(--forum-ink); font-weight: var(--w-semibold); }
  .cover__actions { display: flex; gap: var(--space-2); flex: none; flex-wrap: wrap; justify-content: flex-end; }

  .grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5) var(--space-5);
    background: var(--forum-bg);
  }
  .col { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }

  .about { margin: 0; font: var(--type-body); color: var(--forum-ink-soft); white-space: pre-wrap; }
  .muted { margin: 0; font: var(--type-meta); color: var(--forum-ink-faint); }

  .posts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .posts li {
    display: flex; flex-direction: column; gap: 3px;
    padding: var(--space-3) 0;
    border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .posts li:last-child { border-bottom: none; padding-bottom: 2px; }
  .posts li:first-child { padding-top: 2px; }
  .posts__title { font: var(--type-thread-title); color: var(--forum-ink); text-decoration: none; }
  .posts__title:hover { color: var(--forum-link); }
  .posts__meta { font: var(--type-meta); color: var(--forum-ink-soft); }

  .sig-note { margin-bottom: var(--space-2); }
  /* inside a Card with a note above, drop the post-context top margin */
  .sig { margin-top: 0; }

  .standing { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
  .standing__stats { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); font: var(--type-meta); color: var(--forum-ink-soft); }
  .standing__stats b { color: var(--forum-ink); font-weight: var(--w-semibold); }
  .standing__seen { font: var(--type-meta); color: var(--forum-ink-faint); }

  .network-stats {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3);
    padding-bottom: var(--space-3); border-bottom: var(--border-hair) solid var(--forum-line);
  }
  .network-stats div { display: flex; flex-direction: column; gap: 1px; }
  .network-stats b { font: var(--w-semibold) var(--text-lg)/1.2 var(--font-display); color: var(--forum-ink); }
  .network-stats span { font: var(--type-meta); color: var(--forum-ink-faint); }
  .forum-activity { list-style: none; margin: 0; padding: var(--space-2) 0 0; }
  .forum-activity li {
    display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3);
    padding: var(--space-2) 0; border-bottom: var(--border-hair) solid var(--forum-line);
    font: var(--type-meta);
  }
  .forum-activity li:last-child { border-bottom: none; }
  .forum-activity__name { display: flex; align-items: center; gap: var(--space-1); min-width: 0; overflow-wrap: anywhere; color: var(--forum-ink); font-weight: var(--w-semibold); }
  .forum-activity__count { display: flex; flex-direction: column; align-items: flex-end; color: var(--forum-ink-soft); white-space: nowrap; }
  .forum-activity__count small { font: inherit; color: var(--forum-ink-faint); }
  .public-note { margin-top: var(--space-1); }

  .elsewhere { list-style: none; margin: 0 0 var(--space-2); padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .elsewhere li { display: flex; align-items: center; gap: var(--space-2); font: var(--type-meta); }
  .elsewhere__icon { flex: none; font-size: 15px; line-height: 1; }
  .elsewhere a { text-decoration: none; color: var(--forum-ink); }
  .elsewhere a:hover { color: var(--forum-link); }
  .elsewhere a b, .elsewhere span b { font-weight: var(--w-semibold); }
  .elsewhere__sub { color: var(--forum-ink-faint); }

  .bposts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .bposts li {
    display: flex; flex-direction: column; gap: 3px;
    padding: var(--space-2) 0;
    border-top: var(--border-hair) solid var(--forum-line);
  }
  .bposts li:first-child { border-top: none; padding-top: 0; }
  .bposts__text {
    font: var(--type-body); color: var(--forum-ink); text-decoration: none;
    white-space: pre-wrap; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .bposts__text:hover { color: var(--forum-link); }
  .bposts__meta { display: flex; flex-wrap: wrap; gap: 4px; font: var(--type-meta); color: var(--forum-ink-soft); }

  .identity { display: flex; flex-direction: column; gap: var(--space-2); }
  .identity__row { display: flex; gap: var(--space-3); font: var(--type-meta); color: var(--forum-ink-soft); }
  .identity__k { color: var(--forum-ink-faint); min-width: 68px; }
  .identity__did {
    display: block; padding: 8px 10px;
    background: var(--forum-sunken); border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-sm); box-shadow: var(--shadow-well);
    font: var(--type-handle); color: var(--forum-ink-soft); word-break: break-all;
  }

  @media (max-width: 860px) {
    .grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .cover { flex-wrap: wrap; }
    .cover__actions { width: 100%; justify-content: flex-start; }
  }
  }
</style>
