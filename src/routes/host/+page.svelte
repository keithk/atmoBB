<script lang="ts">
  let { data, form } = $props();

  const statusLabel: Record<string, string> = {
    pending: 'waiting for approval',
    provisioning: 'being set up',
    live: 'live',
    failed: "couldn't be set up",
    rejected: 'not approved',
  };
</script>

<h1>Host a forum</h1>

<div class="atm-card atm-card--edge host__intro">
  <div class="atm-card__body">
    <p>
      This is a very early attempt at “hosted for you” forums on atproto. It's meant for people
      who already understand how atproto works and are comfortable with rough edges. Requesting a
      forum here means taking a leap on unfinished software and a hosting experiment that will
      change as we learn what works.
    </p>
    <p>
      <strong>A fair warning:</strong> if you've ended up on this page, you most likely want to
      <a href="https://github.com/keithk/atmoBB">host atmobb yourself</a>. Self-hosting gives you
      control over the software and your forum's infrastructure. This hosted option is for people
      who knowingly want to try the constrained, experimental version anyway. It's running as a
      separate installation on my own personal infrastructure, so I won't be taking on a ton of
      forums 😥. The idea is to make it easy to pop out and build your own when you're ready.
    </p>
    <p>
      If you do continue, we'll run an atmobb forum for you on its own subdomain. It will appear
      in the shared forum index, and members can sign in with the atproto accounts they already
      use. Hosted forums don't support members-only boards.
    </p>
    <p>
      You'll need an invite code and a separate atproto account for the forum. Create a new
      account instead of using your personal one. The forum account will own its boards, staff
      list, and moderation history.
    </p>
  </div>
</div>

{#if data.mine.length}
  <div class="atm-panel host__mine">
    <div class="atm-board-section">Your requests</div>
    {#each data.mine as r}
      <div class="host__request">
        <b>{r.subdomain}.{data.suffix}</b>
        <span> · {statusLabel[r.status] ?? r.status}</span>
        {#if r.status === 'live'}
          <a href="https://{r.subdomain}.{data.suffix}">open your forum →</a>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if form?.submitted}
  <p class="atm-ok">Request sent. Check back here to see when your forum is ready.</p>
{/if}
{#if form?.message}<p class="atm-err">{form.message}</p>{/if}

{#if !data.user}
  <p><a href="/login">Log in</a> with your personal account to request a forum.</p>
{:else if !data.mine.some((r) => r.status !== 'rejected')}
  <div class="atm-card atm-card--edge">
    <div class="atm-card__header"><span>Request a forum</span></div>
    <div class="atm-card__body">
      <form class="atm-editform" method="POST">
        <div class="atm-field">
          <span class="atm-label">Invite code</span>
          <input class="atm-input" name="code" required autocomplete="off" />
        </div>
        <div class="atm-field">
          <span class="atm-label">Subdomain</span>
          <div class="host__subdomain">
            <input class="atm-input" name="subdomain" required pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" />
            <span class="host__suffix">.{data.suffix}</span>
          </div>
          <span class="atm-hint">{data.subdomainRule}</span>
        </div>
        <div class="atm-field">
          <span class="atm-label">Forum account handle</span>
          <input class="atm-input" name="forumHandle" required placeholder="my-forum.bsky.social" />
          <span class="atm-hint">Use the new account you made for this forum.</span>
        </div>
        <div class="atm-field">
          <span class="atm-label">Email (optional)</span>
          <input class="atm-input" name="email" type="email" autocomplete="email" />
          <span class="atm-hint">We'll email you when the forum is ready.</span>
        </div>
        <div class="atm-editform__actions">
          <button class="atm-btn atm-btn--primary">request forum</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .host__intro,
  .host__mine {
    margin-bottom: var(--space-5);
    max-width: 64ch;
  }
  .host__request {
    padding: var(--space-3) var(--space-4);
  }
  .host__subdomain {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .host__suffix {
    color: var(--forum-ink-soft);
    font: var(--type-ui);
  }
</style>
