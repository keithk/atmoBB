<script lang="ts">
  import { onMount } from 'svelte';
  import AppStack from '$lib/components/AppStack.svelte';
  import AtmosphereCard from '$lib/components/AtmosphereCard.svelte';
  import LoginCard from '$lib/components/LoginCard.svelte';
  import PageBar from '$lib/components/PageBar.svelte';
  import { networkApps } from '$lib/network-apps';
  import NetworkOrbit from './NetworkOrbit.svelte';
  import ThemeTour from './ThemeTour.svelte';

  // atmobb.app's front page for signed-out visitors (ATMOBB_MARKETING_HOMEPAGE=1).
  // It sits in the forum's own shell, so the sidebar still lists the real boards.

  const installCommand =
    "curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/keithk/atmoBB/main/install.sh | sh";
  const tangled = networkApps.find((app) => app.slug === 'tangled') ?? networkApps[0];

  // The copy button appears once the page can run it; until then the command
  // is plain text to select.
  let canCopy = $state(false);
  let copyStatus = $state('');
  let commandEl = $state<HTMLElement>();
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => {
    canCopy = true;
    return () => clearTimeout(clearTimer);
  });

  function say(message: string) {
    // Clear first so a repeated message is announced again.
    copyStatus = '';
    clearTimeout(clearTimer);
    requestAnimationFrame(() => {
      copyStatus = message;
      clearTimer = setTimeout(() => (copyStatus = ''), 4000);
    });
  }

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(installCommand);
      say('Copied. Paste it into a shell on your server.');
    } catch {
      if (!commandEl) return;
      const range = document.createRange();
      range.selectNodeContents(commandEl);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      say('Selected. Copy it with your keyboard.');
    }
  }
</script>

<PageBar description="Forum software for the atmosphere">
  {#snippet crumb()}Home{/snippet}
  <a class="mkt-pagelink" href="/latest">read the forum →</a>
</PageBar>

<div class="mkt">
  <section class="hero" aria-labelledby="mkt-hero">
    <h1 class="hero__title" id="mkt-hero">Run a forum anyone with an <mark>atmosphere account</mark> can join.</h1>
    <div class="hero__copy">
      <p class="lede">
        atmoBB brings phpBB-style forums to the AT Protocol. Boards, threads, signatures, avatars, stamps, a webring.
        <strong>People on Bluesky, Leaflet, Tangled or any other app on the network</strong> log in with the account they
        already have, and their posts stay in it.
      </p>
      <div class="actions">
        <a class="atm-btn atm-btn--primary atm-btn--lg" href="#install">install it →</a>
        <a class="atm-btn atm-btn--secondary atm-btn--lg" href="/latest">read the atmoBB forum</a>
      </div>
      <p class="hero__note">
        Don't want to run a server? <a href="#hosted">I host forums too</a>, for free. Request one and I'll approve it.
      </p>
      <AppStack featured={tangled} />
    </div>
    <NetworkOrbit />
  </section>

  <section class="feature feature--split" aria-labelledby="mkt-members">
    <div class="feature__copy">
      <p class="atm-eyebrow atm-eyebrow--accent">who can join?</p>
      <h2 class="title" id="mkt-members">Your members probably <mark>already have an account</mark>.</h2>
      <p class="body">
        An atmosphere account is one login that works across Bluesky, Leaflet and the other apps on the network. They
        type their handle, approve your forum on their own provider's sign-in page, and they're in. Your forum never sees
        a password. Anyone without one can make a free Bluesky account and use it here.
      </p>
      <dl class="facts">
        <div>
          <dt>Their profile comes along</dt>
          <dd>Name, avatar, pronouns and signature come from their account. They can change any of them just for your forum.</dd>
        </div>
        <div>
          <dt>Posts live in their account</dt>
          <dd>Every thread and reply is saved in the author's own account. If they switch hosts, their posts come along, which is most of the point.</dd>
        </div>
      </dl>
    </div>
    <figure class="feature__visual">
      <LoginCard />
      <figcaption class="caption">
        The log-in card on every atmoBB forum. Bluesky always shows in the app stack, and the second app changes on each visit.
      </figcaption>
    </figure>
  </section>

  <section class="feature" aria-labelledby="mkt-themes">
    <div class="feature__head">
      <p class="atm-eyebrow atm-eyebrow--accent">what will it look like?</p>
      <h2 class="title" id="mkt-themes">Nine themes, then <mark>your own CSS</mark> on top.</h2>
      <p class="body">
        New forums start in Atmosphere. Pick another in the admin panel, then add your own CSS and up to 12 webfonts on
        top. The six light themes go dark when a visitor's device is in dark mode. Custom CSS never touches the admin
        panel, so you can always get back in and fix a broken theme.
      </p>
    </div>
    <ThemeTour />
  </section>

  <section class="feature feature--split feature--flip" aria-labelledby="mkt-admin">
    <div class="feature__copy">
      <p class="atm-eyebrow atm-eyebrow--accent">how do I run it?</p>
      <h2 class="title" id="mkt-admin">You run the whole thing from <mark>the admin panel</mark>.</h2>
      <p class="body">
        Boards, stamps, staff, members, shared topics, extensions and updates each get their own page. When you save,
        the panel waits until the change has reached the index, so it never shows you stale settings.
      </p>
      <dl class="facts">
        <div><dt>Choose who can post</dt><dd>Open to anyone, apply with one question, or invite only. Everyone can still read.</dd></div>
        <div><dt>A public mod log</dt><dd>Every ban, lock, hide and acceptance is a record anyone can read.</dd></div>
        <div><dt>The forum has its own account</dt><dd>Its handle is your domain, and the boards and staff list are saved in it.</dd></div>
        <div><dt>Updates from the panel</dt><dd>Admin → Updates installs a new release and backs up the database first.</dd></div>
      </dl>
    </div>
    <figure class="feature__visual">
      <div class="window">
        <div class="window__bar">
          <span class="window__dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="window__url">yourforum.example/admin/members</span>
        </div>
        <div class="adm" aria-hidden="true">
          <div class="adm__tabs">
            {#each ['Profile', 'Appearance', 'Boards', 'Stamps', 'Staff', 'Members', 'Topics', 'Extensions', 'Updates', 'Connection'] as tab}
              <span class:on={tab === 'Members'}>{tab}</span>
            {/each}
          </div>
          <div class="adm__pane">
            <p class="adm__h">Join mode</p>
            <div class="adm__radios">
              <span class="adm__radio"><span><b>Open:</b> anyone with an atmosphere account can post.</span></span>
              <span class="adm__radio on"><span><b>Apply:</b> people ask to join and staff approve them.</span></span>
              <span class="adm__radio"><span><b>Invite:</b> members and staff hand out invite links.</span></span>
            </div>
            <div class="adm__field"><span>Application question</span><span class="adm__input">What brings you here?</span></div>
            <span class="adm__btn">save join mode</span>
            <p class="adm__h">Applications</p>
            <div class="adm__app">
              <span class="avatar">M</span>
              <span class="handle">@mara.example.com</span>
              <q>I run a zine about bus stops and need somewhere to argue about benches.</q>
              <span class="adm__acts"><span>approve</span><span>hold</span><span>deny</span></span>
            </div>
          </div>
        </div>
      </div>
      <figcaption class="caption">A drawing of Admin → Members using the page's real labels. Mara is an example applicant.</figcaption>
    </figure>
  </section>

  <section class="feature" aria-labelledby="mkt-network">
    <div class="feature__head">
      <p class="atm-eyebrow atm-eyebrow--accent">what about other forums?</p>
      <h2 class="title" id="mkt-network">Boards can <mark>share threads</mark> with other forums.</h2>
      <p class="body">
        Give a board a topic, like <code>gaming</code>, and its threads merge with every board on the network using the
        same topic. Shared threads say which forum they came from and link back to it. You can share a topic with every
        forum, just the ones you list, or nobody.
      </p>
    </div>
    <div>
      <div class="topics art">
        <div class="board board--atmo">
          <div class="board__head"><span class="board__name">Games</span><span class="board__topic">your forum · gaming</span></div>
          <ul>
            <li><span>Co-op games nobody else plays</span><span class="meta">posted here</span></li>
            <li class="arrived"><span>Speedrun night, Friday?</span><span class="via"><i aria-hidden="true"></i>via Pixel Pals</span></li>
          </ul>
        </div>
        <div class="board board--pals">
          <div class="board__head"><span class="board__name">Games</span><span class="board__topic">Pixel Pals · gaming</span></div>
          <ul>
            <li><span>Speedrun night, Friday?</span><span class="meta">posted here</span></li>
            <li><span>Co-op games nobody else plays</span><span class="via"><i aria-hidden="true"></i>via your forum</span></li>
          </ul>
        </div>
      </div>
      <p class="caption caption--after">Pixel Pals is an example forum, drawn in the Bubblegum theme.</p>
      <div class="ring-row">
        <div class="ring-row__copy">
          <h3>And there's a webring!</h3>
          <p>
            Every atmoBB forum is listed in the directory and linked from the webring, so your next member might wander
            in from someone else's forum.
          </p>
        </div>
        <div class="ring-bar" aria-hidden="true"><span>find another forum?</span><b>‹‹ prev</b><b>random</b><b>next ››</b></div>
      </div>
    </div>
  </section>

  <section class="feature" aria-labelledby="mkt-touches">
    <div class="feature__head">
      <p class="atm-eyebrow atm-eyebrow--accent">what else is in there?</p>
      <h2 class="title" id="mkt-touches">Signatures, polls and <mark>no post counts</mark>.</h2>
    </div>
    <div class="touches">
      <article class="touch">
        <div class="touch__art art" aria-hidden="true">
          <div class="stamps">
            <span class="stamp stamp--stamp">early days</span>
            <span class="stamp stamp--pill">first light</span>
            <span class="stamp stamp--ticket">original member</span>
            <span class="stamp stamp--pixel"># games</span>
          </div>
        </div>
        <div class="touch__body">
          <h3>Stamps instead of post counts</h3>
          <p>Nobody ranks up for posting a lot. Stamps show when someone arrived and where they've posted. You design your own, and members choose up to six to wear.</p>
        </div>
      </article>

      <article class="touch">
        <div class="touch__art art" aria-hidden="true">
          <div class="mini poll">
            <b>Game night this Friday?</b>
            <span class="poll__opt" style="--v: 58%"><span>Speedruns</span><span>58%</span></span>
            <span class="poll__opt" style="--v: 31%"><span>Co-op</span><span>31%</span></span>
            <span class="poll__opt" style="--v: 11%"><span>Board games</span><span>11%</span></span>
            <span class="poll__meta">closes in 2 days</span>
          </div>
        </div>
        <div class="touch__body">
          <h3>Polls, spoilers and quotes</h3>
          <p>A poll takes 2 to 10 options and can close after a set number of days. Spoilers stay hidden until clicked, and quoting a post links back to it.</p>
        </div>
      </article>

      <article class="touch">
        <div class="touch__art art" aria-hidden="true">
          <div class="mini prof">
            <div class="prof__banner"></div>
            <div class="prof__who"><span class="avatar">M</span><b>Mara</b></div>
            <div class="prof__lines">
              <p>currently: rereading Earthsea</p>
              <div class="prof__tabs"><span>about me</span><span>stamp shelf</span><span>Regulars</span><span>guestbook</span></div>
            </div>
          </div>
        </div>
        <div class="touch__body">
          <h3>Profile pages they make their own</h3>
          <p>Members pick a skin and a banner, then choose which panels show up and in what order. There's a guestbook!</p>
        </div>
      </article>

      <article class="touch">
        <div class="touch__art art" aria-hidden="true">
          <div class="notify">
            <span class="bell">
              <svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
              <b>2</b>
            </span>
            <div class="channels"><span>web push</span><span>email</span><span>Telegram</span><span>Bluesky DM</span><span>webhook</span></div>
          </div>
        </div>
        <div class="touch__body">
          <h3>Notifications through atmo.pub</h3>
          <p>Replies, quotes and @mentions go out through atmo.pub, and each member picks the channel. The forum sends and atmo.pub delivers.</p>
        </div>
      </article>

      <article class="touch">
        <div class="touch__art art" aria-hidden="true">
          <div class="mini ext">
            <span>Install from a git URL</span>
            <span class="adm__input">https://example.com/you/dice.git</span>
            <div class="ext__row"><small>runs in a sandbox</small><span class="adm__btn">review release</span></div>
          </div>
        </div>
        <div class="touch__body">
          <h3>Extensions without server access</h3>
          <p>Paste a repository's URL to add an extension. It runs in a sandbox and can only write the records you approved when you reviewed it.</p>
        </div>
      </article>

      <article class="touch">
        <div class="touch__art art" aria-hidden="true">
          <div class="mini online">
            <div class="online__head">Who's online</div>
            <div class="online__body">
              <div class="faces">
                <span style="background: #3f7d6c">M</span><span style="background: #7a59e6">B</span><span style="background: #c0562f">N</span><span style="background: #2f5f9e">J</span>
              </div>
              <p>4 members and 11 guests. Most ever online: 52.</p>
              <p class="online__sig">a signature, under every post</p>
            </div>
          </div>
        </div>
        <div class="touch__body">
          <h3>Who's online, and signatures</h3>
          <p>A who's-online box with the all-time record, and up to three blocks of signature under every post. Very phpBB.</p>
        </div>
      </article>
    </div>
  </section>

  <section class="feature" aria-labelledby="mkt-gaps">
    <div class="feature__head">
      <p class="atm-eyebrow atm-eyebrow--accent">what's missing?</p>
      <h2 class="title" id="mkt-gaps">What it doesn't do yet</h2>
      <p class="body">I built atmoBB for myself and it's offered as-is, with no roadmap. If you want something different, you can just build it.</p>
    </div>
    <ul class="gaps">
      <li>Search</li>
      <li>RSS</li>
      <li>Private messages</li>
      <li>Reactions</li>
      <li>Importing a phpBB or Discourse board</li>
    </ul>
  </section>

  <section class="feature" aria-labelledby="mkt-start">
    <div class="feature__head">
      <p class="atm-eyebrow atm-eyebrow--accent">how do I get it?</p>
      <h2 class="title" id="mkt-start">Start <mark>yours</mark>.</h2>
    </div>
    <div class="ways">
      <div class="way-main" id="install">
        <AtmosphereCard badge="→">
          <div class="way__content">
            <h3>On your own server</h3>
            <p>
              Free and MIT licensed. You need a Linux server with Docker Compose 2.20 or newer, and two hostnames pointed
              at it: one for the forum and one for its indexer.
            </p>
            <div class="cmd">
              <pre><code bind:this={commandEl}><span class="nw">curl --proto '=https'</span> <span class="nw">--tlsv1.2 -fsSL</span> https://raw.githubusercontent.com/keithk/atmoBB/main/install.sh <span class="nw">| sh</span></code></pre>
              {#if canCopy}
                <button type="button" onclick={copyInstall}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
                  copy
                </button>
              {/if}
            </div>
            <p class="copy-status" role="status">{copyStatus}</p>
            <p class="note">The installer asks for your forum's hostname, your handle and the forum's handle, then shows the whole plan before it changes anything.</p>
            <a class="atm-btn atm-btn--secondary" href="https://github.com/keithk/atmoBB/blob/main/docs/self-hosting.md">self-hosting guide</a>
          </div>
        </AtmosphereCard>
      </div>
      <div class="way" id="hosted">
        <h3>Hosted at yourforum.atmobb.app</h3>
        <p>Free. Request a forum and I'll approve it. I run the server and the updates, and you bring an atmosphere account for the forum itself.</p>
        <a class="atm-btn atm-btn--secondary" href="/host">request a forum</a>
      </div>
    </div>
  </section>
</div>

<style>
  @layer atmobb {
  .mkt {
    --dash: color-mix(in oklch, var(--forum-accent) 65%, var(--forum-line));
    --app-chip: #fff;
    /* Pixel Pals, drawn in the Bubblegum theme */
    --pals-surface: #fff;
    --pals-head: #ffd6e8;
    --pals-ink: #2b1b2e;
    --pals-ink-soft: #64465d;
    --pals-edge: #2b1b2e;
    --pals-pink: #ff5fa8;
    --pals-link: #086c67;
    --cmd-bg: #1b2430;
    max-width: 1140px;
    color: var(--forum-ink);
  }
  @media (prefers-color-scheme: dark) {
    .mkt {
      --app-chip: #e8edf3;
      --pals-surface: #34202d;
      --pals-head: #4a1f36;
      --pals-ink: #ffeaf4;
      --pals-ink-soft: #e2b6ce;
      --pals-edge: #ff8cc4;
      --pals-link: #5fe0d3;
      --cmd-bg: #0f141a;
    }
  }
  .mkt :is(h1, h2, h3) { margin: 0; text-wrap: balance; }
  .mkt p { margin: 0; text-wrap: pretty; }
  .mkt mark {
    padding: 0 0.16em;
    color: var(--forum-link);
    background: var(--forum-accent-soft);
    border-radius: var(--radius-xs);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  /* keep a highlighted phrase on one line once there's room, so it reads as one mark */
  @media (min-width: 600px) {
    .mkt :is(h1, h2) mark { white-space: nowrap; }
  }
  .mkt-pagelink { font: var(--type-ui); text-decoration: none; }

  /* the tinted art panel from the log-in card: accent wash, two specks, a dashed edge */
  .art {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 20%, color-mix(in oklch, var(--forum-accent) 45%, transparent) 0 3px, transparent 4px),
      radial-gradient(circle at 80% 78%, color-mix(in oklch, var(--forum-accent) 35%, transparent) 0 4px, transparent 5px),
      var(--forum-accent-soft);
  }

  /* ---- hero: the headline runs the full width, the pitch and the orbit sit under it ---- */
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'head' 'copy' 'art';
    gap: 28px 56px;
    padding-block: clamp(24px, 4vw, 48px) clamp(48px, 6vw, 80px);
  }
  @media (min-width: 1100px) {
    .hero {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      grid-template-areas: 'head head' 'copy art';
      align-items: start;
    }
  }
  .hero__title {
    grid-area: head;
    font: var(--w-regular) clamp(2.35rem, 1.5rem + 2.6vw, 3.6rem) / 1.08 var(--font-display);
    letter-spacing: -0.025em;
  }
  .hero__copy { grid-area: copy; display: flex; flex-direction: column; gap: 20px; padding-top: 6px; }
  .hero :global(.orbit) { grid-area: art; }
  .lede { max-width: 56ch; font: var(--w-regular) clamp(1.05rem, 1rem + 0.25vw, 1.18rem) / 1.6 var(--font-body); color: var(--forum-ink-soft); }
  .lede strong { color: var(--forum-ink); font-weight: var(--w-semibold); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 6px; }
  .hero__note { font: var(--w-regular) var(--text-sm) / 1.5 var(--font-body); color: var(--forum-ink-faint); }

  /* ---- feature sections ---- */
  .feature {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 36px 56px;
    align-items: center;
    padding-block: clamp(48px, 6vw, 88px);
    border-top: 1px dashed var(--forum-line-strong);
    scroll-margin-top: 16px;
  }
  @media (min-width: 1020px) {
    .feature--split { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); }
    .feature--flip { grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); }
    .feature--flip .feature__copy { order: 2; }
  }
  .feature__copy { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .feature__head { display: flex; flex-direction: column; gap: 14px; max-width: 760px; }
  .feature__visual { display: flex; flex-direction: column; gap: 10px; min-width: 0; margin: 0; }
  .title {
    font: var(--w-regular) clamp(1.75rem, 1.35rem + 1.25vw, 2.45rem) / 1.14 var(--font-display);
    letter-spacing: -0.02em;
  }
  .body { max-width: 60ch; font: var(--w-regular) var(--text-base) / 1.6 var(--font-body); color: var(--forum-ink-soft); }
  .body code { font-family: var(--font-mono); }
  .caption { font: var(--w-regular) var(--text-sm) / 1.5 var(--font-body); color: var(--forum-ink-faint); }
  .caption--after { margin-top: 10px; }

  .facts { display: grid; margin: 8px 0 0; }
  .facts div { padding-block: 14px; border-top: 1px dashed var(--forum-line-strong); }
  .facts dt { font-weight: var(--w-semibold); }
  .facts dd { margin: 2px 0 0; font-size: 15px; color: var(--forum-ink-soft); }

  /* ---- admin drawing, with the panel's real tabs and labels ---- */
  .window { overflow: hidden; background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }
  .window__bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--forum-surface-2); border-bottom: 1px solid var(--forum-line); }
  .window__dots { display: flex; gap: 6px; }
  .window__dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--forum-line-strong); }
  .window__url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 3px 12px;
    background: var(--forum-surface);
    border: 1px solid var(--forum-line);
    border-radius: var(--radius-round);
    font: 400 12.5px var(--font-mono);
    color: var(--forum-ink-soft);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .adm__tabs {
    display: flex;
    gap: 2px;
    padding-inline: 14px;
    overflow: hidden;
    border-bottom: 1px solid var(--forum-line);
    white-space: nowrap;
    mask-image: linear-gradient(to right, #000 85%, transparent);
  }
  .adm__tabs span { padding: 12px 9px 10px; font-size: var(--text-sm); color: var(--forum-ink-soft); border-bottom: 2px solid transparent; }
  .adm__tabs .on { color: var(--forum-ink); font-weight: var(--w-medium); border-bottom-color: var(--forum-accent); }
  .adm__pane { display: flex; flex-direction: column; gap: 14px; padding: 20px 22px 24px; font-size: var(--text-sm); }
  .adm__h { padding-bottom: 6px; border-bottom: 1px solid var(--forum-line); font-weight: var(--w-bold); color: var(--forum-ink-soft); }
  .adm__radios { display: flex; flex-direction: column; gap: 8px; }
  .adm__radio { display: flex; align-items: baseline; gap: 10px; color: var(--forum-ink-soft); }
  .adm__radio b { color: var(--forum-ink); font-weight: var(--w-semibold); }
  .adm__radio::before {
    content: '';
    flex: none;
    width: 15px;
    height: 15px;
    translate: 0 2px;
    background: var(--forum-surface);
    border: 1.5px solid var(--forum-line-strong);
    border-radius: 50%;
  }
  .adm__radio.on::before { border-color: var(--forum-accent); background: radial-gradient(circle, var(--forum-accent) 0 3.5px, var(--forum-surface) 4px); }
  .adm__field { display: flex; flex-direction: column; gap: 6px; }
  .adm__field span:first-child { font-size: 13px; font-weight: var(--w-semibold); color: var(--forum-ink-soft); }
  .adm__input { padding: 9px 12px; color: var(--forum-ink); background: var(--forum-surface-2); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-md); }
  .adm__btn { align-self: flex-start; padding: 8px 14px; color: var(--forum-accent-ink); background: var(--forum-accent); border-radius: var(--radius-md); font-size: 13px; font-weight: var(--w-semibold); }
  .adm__app { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 12px; }
  .adm__app .avatar { grid-row: span 2; }
  .adm__app q { color: var(--forum-ink-soft); }
  .adm__acts { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .adm__acts span { padding: 5px 11px; border: 1px solid var(--forum-line-strong); border-radius: var(--radius-sm); font-size: 12.5px; font-weight: var(--w-semibold); color: var(--forum-ink); }
  .adm__acts span:first-child { color: var(--forum-accent-ink); background: var(--forum-accent); border-color: var(--forum-accent); }
  .avatar { display: grid; flex: none; place-items: center; width: 40px; height: 40px; color: #fff; background: #3f7d6c; border-radius: var(--radius-md); font-size: 17px; font-weight: var(--w-bold); }
  .handle { overflow-wrap: anywhere; font: 400 13px var(--font-mono); color: var(--forum-ink); }

  /* ---- shared topics: your forum in this theme, Pixel Pals in Bubblegum ---- */
  .topics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
    align-items: start;
    gap: 20px;
    padding: clamp(20px, 3vw, 36px);
    border: 1px dashed var(--dash);
    border-radius: var(--radius-lg);
  }
  .board { overflow: hidden; font-size: 15px; }
  .board ul { margin: 0; padding: 4px 0; list-style: none; }
  .board li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 2px 10px; padding: 11px 16px; }
  .board__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 8px; padding: 11px 16px; }
  .board__name { font-weight: 650; }
  .board__topic { font: 500 12px var(--font-mono); }
  .via { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
  .via i { flex: none; width: 9px; height: 9px; border-radius: 50%; }
  .meta { font-size: 13px; }
  .board--atmo { background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }
  .board--atmo .board__head { background: var(--forum-surface-2); border-bottom: 1px solid var(--forum-line); }
  .board--atmo .board__name::before { content: '#'; margin-right: 0.25em; font-weight: 400; color: var(--forum-ink-faint); }
  .board--atmo :is(.board__topic, .meta) { color: var(--forum-ink-faint); }
  .board--atmo .via { color: var(--forum-link); }
  .board--atmo .via i { background: var(--pals-pink); }
  .board--atmo li.arrived { background: var(--forum-pin-bg); }
  .board--pals {
    color: var(--pals-ink);
    background: var(--pals-surface);
    border: 2px solid var(--pals-edge);
    border-radius: 16px;
    box-shadow: 4px 4px 0 var(--pals-edge);
    font-family: 'Nunito', system-ui, sans-serif;
    font-weight: 700;
  }
  .board--pals .board__head { background: var(--pals-head); border-bottom: 2px solid var(--pals-edge); }
  .board--pals .board__name { font-weight: 800; }
  .board--pals :is(.board__topic, .meta) { color: var(--pals-ink-soft); }
  .board--pals .via { color: var(--pals-link); }
  .board--pals .via i { background: var(--forum-accent); }
  .board--pals li + li { border-top: 2px dashed var(--pals-head); }
  .ring-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 32px;
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px dashed var(--forum-line-strong);
  }
  .ring-row__copy { display: flex; flex-direction: column; gap: 4px; max-width: 54ch; }
  .ring-row h3 { font: var(--w-semibold) 1.15rem / 1.3 var(--font-display); }
  .ring-row p { color: var(--forum-ink-soft); }
  .ring-bar {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    max-width: 100%;
    padding: 10px 18px;
    font-size: var(--text-sm);
    color: var(--forum-ink-soft);
    background: var(--forum-surface);
    border: 1px dashed var(--forum-line-strong);
    border-radius: var(--radius-round);
  }
  .ring-bar b { font-weight: var(--w-medium); color: var(--forum-link); }

  /* ---- the smaller touches: each card draws the real thing in miniature ---- */
  .touches { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 20px; margin-top: 8px; }
  .touch { display: flex; flex-direction: column; overflow: hidden; background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-lg); }
  .touch__art { display: grid; place-items: center; height: 224px; padding: 20px; border-bottom: 1px dashed var(--dash); }
  .touch__body { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px 22px; }
  .touch h3 { font: var(--w-semibold) 1.1rem / 1.3 var(--font-display); letter-spacing: -0.005em; }
  .touch p { font-size: 15px; line-height: 1.6; color: var(--forum-ink-soft); }
  .mini { font-size: 13px; background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-md); }

  .stamps { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 280px; }
  .stamp { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font: 700 11.5px/1 var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; }
  .stamp--pill { color: #6d3800; background: #fde4c2; border-radius: var(--radius-round); }
  .stamp--stamp { padding: 9px 12px; color: #34489a; background: #e6ebf8; border-radius: 4px; outline: 2px dashed #34489a; outline-offset: -5px; }
  .stamp--ticket {
    padding: 7px 16px;
    color: #1d5a3c;
    background: #d4efe0;
    mask:
      radial-gradient(circle 6px at 0 50%, #0000 98%, #000) left / 51% 100% no-repeat,
      radial-gradient(circle 6px at 100% 50%, #0000 98%, #000) right / 51% 100% no-repeat;
  }
  .stamp--pixel { color: #682576; background: #f2dcf6; box-shadow: 0 -3px 0 -1px #f2dcf6, 0 3px 0 -1px #f2dcf6, -3px 0 0 -1px #f2dcf6, 3px 0 0 -1px #f2dcf6; }

  .poll { display: flex; flex-direction: column; gap: 8px; width: min(260px, 100%); padding: 14px; }
  .poll b { font-size: var(--text-sm); }
  .poll__opt { position: relative; display: flex; justify-content: space-between; overflow: hidden; padding: 6px 10px; background: var(--forum-surface-2); border-radius: var(--radius-sm); }
  .poll__opt::before { content: ''; position: absolute; inset: 0 auto 0 0; width: var(--v); background: var(--forum-accent-soft); }
  .poll__opt span { position: relative; }
  .poll__opt span:last-child { color: var(--forum-ink-soft); font-variant-numeric: tabular-nums; }
  .poll__meta { font-size: 12px; color: var(--forum-ink-faint); }

  .prof { overflow: hidden; width: min(250px, 100%); }
  /* the "stars" banner on the plum swatch, as the profile page draws it */
  .prof__banner {
    height: 54px;
    background-color: #6b3a6b;
    background-image:
      radial-gradient(circle at 20% 30%, rgb(255 255 255 / 0.4) 1.5px, transparent 2px),
      radial-gradient(circle at 70% 65%, rgb(255 255 255 / 0.4) 1px, transparent 1.5px);
    background-size: 48px 48px;
  }
  .prof__who { display: flex; align-items: flex-end; gap: 10px; margin-top: -20px; padding: 0 12px; }
  .prof__who .avatar { width: 46px; height: 46px; border: 3px solid var(--forum-surface); }
  .prof__who b { padding-bottom: 2px; font-size: 15px; }
  .prof__lines { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 12px; }
  .prof__lines p { color: var(--forum-ink-soft); }
  .prof__tabs { display: flex; flex-wrap: wrap; gap: 4px; }
  .prof__tabs span { padding: 2px 8px; font-size: 11.5px; color: var(--forum-ink-soft); background: var(--forum-surface-2); border: 1px solid var(--forum-line); border-radius: var(--radius-round); }

  .notify { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .bell { position: relative; display: grid; place-items: center; width: 52px; height: 52px; color: var(--forum-ink); background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: 50%; box-shadow: var(--shadow-md); }
  .bell svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  .bell b {
    position: absolute;
    top: -4px;
    right: -6px;
    display: grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    font-size: 12px;
    color: var(--forum-accent-ink);
    background: var(--forum-accent);
    border: 2px solid var(--forum-surface);
    border-radius: var(--radius-round);
  }
  .channels { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 260px; }
  .channels span { padding: 4px 10px; font-size: 12.5px; background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-round); }

  .ext { display: flex; flex-direction: column; gap: 8px; width: min(270px, 100%); padding: 14px; }
  .ext > span:first-child { font-size: 12.5px; font-weight: var(--w-semibold); color: var(--forum-ink-soft); }
  .ext .adm__input { overflow: hidden; padding: 7px 10px; font: 400 12px var(--font-mono); white-space: nowrap; text-overflow: ellipsis; }
  .ext__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ext__row small { font-size: 11.5px; color: var(--forum-ink-faint); }

  .online { width: min(270px, 100%); }
  .online__head { padding: 8px 12px; font-size: 12.5px; font-weight: var(--w-bold); color: var(--forum-ink-soft); border-bottom: 1px solid var(--forum-line); }
  .online__body { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; }
  .online__body p { color: var(--forum-ink-soft); }
  .faces { display: flex; gap: 6px; }
  .faces span { position: relative; display: grid; place-items: center; width: 28px; height: 28px; color: #fff; border-radius: 8px; font-size: 12px; font-weight: var(--w-bold); }
  .faces span::after { content: ''; position: absolute; right: -3px; bottom: -3px; width: 10px; height: 10px; background: var(--online); border: 2px solid var(--forum-surface); border-radius: 50%; }
  .online__sig { padding-top: 8px; font-style: italic; border-top: 1px dashed var(--forum-line-strong); }

  /* ---- not built yet ---- */
  .gaps { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .gaps li { padding: 6px 12px; font-size: 15px; color: var(--forum-ink-soft); background: var(--forum-sunken); border-radius: var(--radius-sm); }

  /* ---- start: self-hosting framed like the log-in card, hosting beside it ---- */
  .ways { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 20px; margin-top: 8px; }
  @media (min-width: 1020px) { .ways { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
  .way-main { min-width: 0; scroll-margin-top: 16px; }
  .way-main :global(.atm-pitch) { border-color: var(--forum-accent); box-shadow: var(--shadow-md); }
  .way__content { display: flex; flex-direction: column; gap: 14px; }
  .way, .way__content { min-width: 0; }
  .way { display: flex; flex-direction: column; gap: 14px; padding: 24px; background: var(--forum-surface); border: 1px solid var(--forum-line-strong); border-radius: var(--radius-lg); scroll-margin-top: 16px; }
  :is(.way, .way__content) h3 { font: var(--w-semibold) 1.3rem / 1.3 var(--font-display); letter-spacing: -0.01em; }
  :is(.way, .way__content) > p { color: var(--forum-ink-soft); }
  :is(.way, .way__content) > .atm-btn { align-self: flex-start; }
  .note { font-size: var(--text-sm); }

  .cmd { display: flex; align-items: stretch; overflow: hidden; color: #e8edf3; background: var(--cmd-bg); border-radius: var(--radius-md); }
  .cmd pre { flex: 1; min-width: 0; margin: 0; padding: 16px 18px; white-space: pre-wrap; overflow-wrap: anywhere; font: 400 14px/1.55 var(--font-mono); }
  .cmd pre::before { content: '$ '; color: #8693a3; }
  .nw { white-space: nowrap; }
  .cmd button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 20px;
    color: var(--forum-accent-ink);
    background: var(--forum-accent);
    border: 0;
    font: var(--w-semibold) 15px var(--font-body);
    cursor: pointer;
  }
  .cmd button:hover { background: var(--forum-accent-hover); }
  .cmd button:focus-visible { outline: 2px solid var(--forum-accent-ink); outline-offset: -5px; border-radius: var(--radius-sm); }
  .cmd button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  .copy-status { font-size: var(--text-sm); color: var(--ok-1); }
  .copy-status:empty { display: none; }

  @media (max-width: 600px) {
    .actions .atm-btn { flex: 1 1 auto; }
    .cmd { flex-direction: column; }
    .adm__pane { padding: 16px; }
  }
  }
</style>
