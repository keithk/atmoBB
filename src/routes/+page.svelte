<script lang="ts">
  import { boardPath, threadPath } from '$lib/appview-paths';
  import AtmosphereExplainer from '$lib/components/AtmosphereExplainer.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Card from '$lib/components/Card.svelte';
  import LoginForm from '$lib/components/LoginForm.svelte';
  import MemberLink from '$lib/components/MemberLink.svelte';
  import BoardMarker from '$lib/components/BoardMarker.svelte';
  import NotifyPrompt from '$lib/components/NotifyPrompt.svelte';
  import TopicList from '$lib/components/TopicList.svelte';
  import { relTime } from '$lib/reltime';
  import type { LatestThreads } from '$lib/server/appview';

  let { data } = $props();

  const authorName = (post?: { author: string; authorProfile?: { displayName?: string } }) =>
    post
      ? (post.authorProfile?.displayName ?? data.handles[post.author] ?? post.author.slice(8, 18))
      : '';
  const activeView = $derived(data.homeView ?? (data.homepage.layout === 'latest' ? 'latest' : 'categories'));
</script>

{#snippet topicList(threads: LatestThreads['threads'], emptyMessage: string)}
  <TopicList {threads} {emptyMessage} handles={data.handles} accountDid={data.user?.did} forumDid={data.forumDid} showBoard embedded />
{/snippet}

{#if data.appviewDown}
  <p class="atm-notice atm-notice--danger">
    We can't load the forum right now. Posts are still safe in their authors'
    accounts. Try again in a few minutes.
  </p>
{/if}

<div class="stack">
  {#if !data.user && data.homepage.welcome === 'classic'}
    <section class="atm-card atm-card--edge hero">
      <div class="hero__grid">
        <h2 class="atm-headline">
          Log in with your <mark>atmosphere account</mark>.
        </h2>
        <div class="hero__login">
          <LoginForm />
        </div>
      </div>
      <div class="hero__more">
        <AtmosphereExplainer />
      </div>
    </section>
  {:else if !data.user && data.homepage.welcome === 'compact'}
    <section class="atm-card atm-card--edge atm-home-welcome atm-home-welcome--compact compact-welcome">
      <div>
        <div class="atm-eyebrow">Welcome</div>
        <p>Join the conversation with your atmosphere account.</p>
      </div>
      <a class="atm-btn atm-btn--primary" href="/login">log in</a>
    </section>
  {/if}

  {#if data.user && data.offerNotifications}
    <NotifyPrompt next="/" />
  {/if}

  <nav class="atm-home-nav" aria-label="Homepage views">
    {#each [{ value: 'categories', label: 'Categories' }, { value: 'latest', label: 'Latest' }, { value: 'hot', label: 'Hot' }] as view}
      <a class:atm-home-nav__item--active={activeView === view.value} class="atm-home-nav__item" href="/?view={view.value}" aria-current={activeView === view.value ? 'page' : undefined}>{view.label}</a>
    {/each}
  </nav>

  {#if data.featured.length}
    <section class="atm-panel atm-home-featured">
      <div class="atm-board-section">Featured topics</div>
      {@render topicList(data.featured, '')}
    </section>
  {/if}

  {#if data.homeView === 'hot'}
    <section class="atm-panel atm-home-hot" id="hot">
      <div class="atm-board-section">Hot among recent topics</div>
      <p class="atm-home-section-note">Ranked by replies among the 100 most recently active visible topics.</p>
      {@render topicList(data.hot, 'No recent topics have replies yet.')}
    </section>
  {:else if data.homeView === 'latest' || (!data.homeView && data.homepage.layout === 'latest')}
    <section class="atm-panel atm-home-latest" id="latest">
      <div class="atm-board-section">Latest activity</div>
      {@render topicList(data.latest, 'No activity yet. Start the first thread.')}
    </section>
  {:else if !data.homeView && data.homepage.layout === 'boards' && data.hot.length}
    <section class="atm-panel atm-home-hot" id="hot">
      <div class="atm-board-section">Hot among recent topics</div>
      <p class="atm-home-section-note">Most replied-to topics in the recent activity window.</p>
      {@render topicList(data.hot.slice(0, 3), '')}
    </section>
  {/if}

  {#if data.homeView === 'categories' || (!data.homeView && data.homepage.layout !== 'latest')}
  <div class:atm-home-main--split={!data.homeView && data.homepage.layout === 'categories-latest'} class="atm-home-main">
    <div class="atm-home-categories" id="categories">
  {#each data.groups as group}
    <section class="atm-panel">
      <div class="atm-board-section">{group.title}</div>
      {#each group.boards as board}
        <article class="atm-boardrow">
          <span class="atm-boardrow__icon {board.value.topic ? 'atmo__icon' : ''}" aria-hidden="true">
            {#if board.value.color}<BoardMarker color={board.value.color} />{:else}{board.value.topic ? '⁂' : '▤'}{/if}
          </span>
          <div>
            <div class="atm-boardrow__name">
              <a href={boardPath(board.uri, data.forumDid)}>{board.value.name}</a>
              {#if board.value.access?.space}
                <span class="atm-chip" title="members-only board">🔒</span>
              {/if}
              {#if board.value.topic}
                <span class="atm-chip atm-chip--topic">⁂ {board.value.topic}</span>
              {/if}
            </div>
            {#if board.value.description}
              <div class="atm-boardrow__desc">{board.value.description}</div>
            {/if}
            {#if board.children.length}
              <div class="atm-boardrow__subs">
                {#each board.children as child}
                  <a href={boardPath(child.uri, data.forumDid)}>↳ {child.value.name}</a>
                {/each}
              </div>
            {/if}
          </div>
          {#if board.locked}
            <div class="atm-boardrow__counts locked-tag">🔒</div>
            <div class="atm-boardrow__last locked-note">members only</div>
          {:else}
            <div class="atm-boardrow__counts">
              <b>{board.threadCount}</b> threads<br />
              {board.replyCount + board.threadCount} posts
            </div>
            {#if board.latest}
              <div class="atm-boardrow__last">
                <Avatar seed={board.latest.author} profile={board.latest.authorProfile} size={40} />
                <div class="atm-boardrow__last-body">
                  <div class="atm-boardrow__last-title">
                    <a href={threadPath(board.latest.uri)}>{board.latest.title}</a>
                  </div>
                  <div>
                    by <MemberLink did={board.latest.author}>{authorName(board.latest)}</MemberLink>
                    {#if board.latest.origin}· via <span class="atm-via">{board.latest.origin.name ?? board.latest.origin.did.slice(8, 24)}</span>{/if}
                    · {relTime(board.latest.at)}
                  </div>
                </div>
              </div>
            {:else}
              <div class="atm-boardrow__last">No posts yet</div>
            {/if}
          {/if}
        </article>
      {/each}
    </section>
  {:else}
    {#if !data.appviewDown}
      <section class="atm-panel">
        <div class="atm-board-section">Boards</div>
        <p class="atm-empty">No boards have been created yet.</p>
      </section>
    {/if}
  {/each}
    </div>
    {#if !data.homeView && data.homepage.layout === 'categories-latest'}
      <section class="atm-panel atm-home-latest" id="latest">
        <div class="atm-board-section">Latest activity</div>
        {@render topicList(data.latest, 'No activity yet. Start the first thread.')}
      </section>
    {/if}
  </div>
  {/if}

  {#if data.groups.some((g) => g.boards.some((b) => b.value.topic))}
    <div class="atmo__explainer">
      <button
        class="atm-eyebrow atm-eyebrow--accent atmo__how"
        type="button"
        aria-describedby="topic-board-explainer"
      >
        ⁂ how this works
      </button>
      <div class="atmo__tooltip" id="topic-board-explainer" role="tooltip">
        Boards marked ⁂ show threads from other forums that use the same topic.
        Threads from this board appear on those forums too. Your posts always
        stay in your account.
      </div>
    </div>
  {/if}

  <div class="panels">
    <div class="panels__col">
      <Card title="Who's online">
        {@const onlineMembers = data.presence.members.filter((m) => m.presence === 'online').length}
        <div class="atm-who__count">
          <b>{onlineMembers}</b> {onlineMembers === 1 ? 'member' : 'members'},
          <b>{data.presence.guests}</b> {data.presence.guests === 1 ? 'guest' : 'guests'} online now
        </div>
        {#if data.presence.members.length}
          <div class="atm-who__list">
            {#each data.presence.members as m}
              <MemberLink did={m.did} class="atm-who__chip">
                <Avatar seed={m.did} profile={data.avatarProfiles[m.did]} size={28} />
                @{data.handles[m.did] ?? m.did.slice(8, 20)}
                <span class="atm-who__dot" style="background: var(--{m.presence})"></span>
              </MemberLink>
            {/each}
          </div>
          <div class="atm-who__legend">
            <span class="atm-who__key"><span class="atm-who__dot" style="background: var(--online)"></span> online</span>
            <span class="atm-who__key"><span class="atm-who__dot" style="background: var(--idle)"></span> idle</span>
          </div>
        {:else}
          <p class="who__empty">No members are online right now.</p>
        {/if}
        {#if data.presence.high.count}
          <p class="who__high">
            Most ever online: <b>{data.presence.high.count}</b> · {relTime(data.presence.high.at)}
          </p>
        {/if}
      </Card>
      <Card title="Forum identity">
        <p class="idnote">
          This forum has its own atmosphere account. Its boards, rules, and
          moderation settings live in that account. Your posts stay in yours.
        </p>
      </Card>
    </div>
    <Card title="Board stats">
      <div class="stats">
        <div class="stats__row"><span>Threads</span><b>{data.stats.threads}</b></div>
        <div class="stats__row"><span>Posts</span><b>{data.stats.posts}</b></div>
        <div class="stats__row"><span>Members</span><b>{data.stats.members}</b></div>
        {#if data.stats.newestMember}
          {@const nm = data.stats.newestMember}
          {@const handle = data.handles[nm.did]}
          <div class="stats__row">
            <span>Newest member</span>
            <MemberLink did={nm.did} class="stats__handle-link">
              <code class="stats__handle">{handle && handle !== nm.did ? `@${handle}` : (nm.displayName ?? nm.did.slice(8, 24))}</code>
            </MemberLink>
          </div>
        {/if}
      </div>
    </Card>
  </div>

  <section class="atm-card atm-card--edge sysop">
    <div class="sysop__pitch">
      <div class="atm-eyebrow sysop__eyebrow">for sysops</div>
      <h2 class="sysop__title">Host your own forum.</h2>
      <p class="sysop__body">
        Each atmobb forum has its own atmosphere account and runs on your
        domain. You control how it looks, and members sign in with accounts
        they already have.
      </p>
    </div>
    <a class="atm-btn atm-btn--secondary" href="https://github.com/keithk/atmoBB">atmobb on GitHub →</a>
  </section>
</div>

<style>
  @layer atmobb {
  .stack {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }

  .hero { padding: var(--space-6); overflow: visible; }
  .hero__grid {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: var(--space-6);
    align-items: center;
  }
  .hero__login {
    background: var(--forum-surface-2);
    border: var(--border-hair) solid var(--forum-line);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .hero__more {
    margin-top: var(--space-4);
    border-top: 1px dashed var(--forum-line-strong);
    padding-top: var(--space-4);
  }
  .compact-welcome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
  }
  .compact-welcome p { margin: var(--space-1) 0 0; color: var(--forum-ink-soft); font: var(--type-ui); }

  .atm-home-nav {
    display: flex;
    gap: var(--space-1);
    border-bottom: var(--border-hair) solid var(--forum-line-strong);
  }
  .atm-home-nav__item {
    padding: var(--space-2) var(--space-3);
    color: var(--forum-ink-soft);
    font: var(--w-semibold) var(--text-sm)/1.4 var(--font-body);
    text-decoration: none;
    border-bottom: 3px solid transparent;
  }
  .atm-home-nav__item:hover { color: var(--forum-link); text-decoration: none; }
  .atm-home-nav__item--active { color: var(--forum-link); border-bottom-color: var(--forum-accent); }
  .atm-home-section-note {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    color: var(--forum-ink-faint);
    background: var(--forum-surface-2);
    border-bottom: var(--border-hair) solid var(--forum-line);
    font: var(--type-meta);
  }
  .atm-home-main { display: grid; gap: var(--space-5); min-width: 0; }
  .atm-home-main--split { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
  .atm-home-categories { display: grid; gap: var(--space-5); min-width: 0; }
  .atm-home-main--split .atm-boardrow {
    grid-template-columns: 34px minmax(0, 1fr) auto;
    gap: var(--space-3);
  }
  .atm-home-main--split .atm-boardrow__last { display: none; }
  .atmo__icon { background: var(--forum-accent-soft); color: var(--forum-link); }
  .atmo__explainer {
    position: relative;
    justify-self: start;
  }
  .atmo__how {
    display: inline-flex;
    align-items: center;
    padding: 7px 10px;
    background: var(--forum-accent-soft);
    border: var(--border-hair) solid color-mix(in oklch, var(--forum-accent) 45%, var(--forum-line));
    border-radius: var(--radius-sm);
    cursor: help;
  }
  .atmo__how:hover,
  .atmo__how:focus-visible {
    color: var(--forum-link-hover);
    border-color: var(--forum-accent);
  }
  .atmo__tooltip {
    position: absolute;
    z-index: 50;
    top: 50%;
    left: calc(100% + var(--space-2));
    width: min(620px, calc(100vw - 200px));
    padding: var(--space-3) var(--space-4);
    color: var(--forum-ink-soft);
    background: var(--forum-surface);
    border: var(--border-hair) solid var(--forum-line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    font: var(--type-meta);
    opacity: 0;
    visibility: hidden;
    transform: translate(-3px, -50%);
    pointer-events: none;
    transition:
      opacity var(--dur-fast) var(--ease),
      visibility var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  .atmo__explainer:hover .atmo__tooltip,
  .atmo__explainer:focus-within .atmo__tooltip {
    opacity: 1;
    visibility: visible;
    transform: translateY(-50%);
  }
  @media (prefers-reduced-motion: reduce) {
    .atmo__tooltip { transition: none; }
  }

  .panels {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: var(--space-5);
    align-items: start;
  }
  .panels__col { display: grid; gap: var(--space-5); }
  .who__empty { font: var(--type-meta); color: var(--forum-ink-soft); margin: 0; }
  .who__high {
    margin: var(--space-3) 0 0;
    padding-top: var(--space-3);
    border-top: 1px dashed var(--forum-line-strong);
    font: var(--type-meta);
    color: var(--forum-ink-soft);
  }
  .who__high b { color: var(--forum-ink); }
  .stats { display: grid; gap: var(--space-2); }
  .stats__row {
    display: flex;
    justify-content: space-between;
    font: var(--type-ui);
    color: var(--forum-ink-soft);
  }
  .stats__row b { color: var(--forum-ink); font-weight: var(--w-semibold); }
  .stats__handle { font: var(--type-handle); color: var(--forum-ink); }
  .idnote { font: var(--type-meta); color: var(--forum-ink-soft); }
  .locked-tag { color: var(--forum-ink-faint); }
  .locked-note { color: var(--forum-ink-faint); font: var(--type-meta); font-style: italic; }

  .sysop {
    padding: var(--space-5) var(--space-6);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-5);
  }
  .sysop__pitch { flex: 1; min-width: 280px; }
  .sysop__eyebrow { margin-bottom: var(--space-2); }
  .sysop__title {
    font: var(--w-regular) var(--text-lg)/var(--lh-snug) var(--font-display);
    margin: 0 0 var(--space-1);
  }
  .sysop__body {
    font: var(--type-meta);
    color: var(--forum-ink-soft);
    margin: 0;
    max-width: 60ch;
  }

  @media (max-width: 860px) {
    .hero__grid { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
    .atm-home-main--split { grid-template-columns: minmax(0, 1fr); }
    .panels { grid-template-columns: minmax(0, 1fr); }
    .sysop__pitch { min-width: 0; }
  }
  @media (max-width: 720px) {
    .compact-welcome { align-items: flex-start; }
    .atmo__tooltip {
      top: calc(100% + var(--space-2));
      left: 0;
      width: min(460px, calc(100vw - var(--space-8)));
      transform: translateY(-3px);
    }
    .atmo__explainer:hover .atmo__tooltip,
    .atmo__explainer:focus-within .atmo__tooltip { transform: none; }
  }
  }
</style>
