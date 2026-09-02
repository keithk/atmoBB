<script lang="ts">
  import type { Poll, PollResult } from '$lib/server/appview';
  import { pollClosed } from '$lib/poll';

  // A thread's poll: results always, and a vote form for logged-in readers
  // while it's open. Voting and retracting post to the thread page's actions;
  // the retract button is a second submit so it works without JavaScript.
  let {
    poll,
    result,
    canVote,
    syncing = false,
  }: { poll: Poll; result?: PollResult; canVote: boolean; syncing?: boolean } = $props();

  const closed = $derived(pollClosed(poll));
  const counts = $derived(result?.counts ?? poll.options.map(() => 0));
  const voters = $derived(result?.voters ?? 0);
  const mine = $derived(result?.viewerOptions ?? []);
  const max = $derived(Math.max(0, ...counts));
  const pct = (n: number) => (voters ? Math.round((n / voters) * 100) : 0);
  const when = (iso: string) => new Date(iso).toLocaleString();
  const open = $derived(canVote && !closed);
</script>

<section class="atm-poll" aria-label="Poll">
  <div class="atm-poll__head">
    <p class="atm-poll__q">{poll.question ?? 'Poll'}</p>
    <p class="atm-poll__meta">
      {poll.multipleChoice ? 'choose any' : 'choose one'}
      {#if poll.closesAt}· {closed ? 'closed' : 'closes'} {when(poll.closesAt)}{/if}
    </p>
  </div>
  <form method="POST" action="?/vote">
    <div class="atm-poll__body">
      {#each poll.options as option, i}
        <label class="atm-poll__opt" class:atm-poll__opt--lead={max > 0 && counts[i] === max}>
          <div class="atm-poll__optrow">
            <span>
              {#if open}
                <input type={poll.multipleChoice ? 'checkbox' : 'radio'} name="option" value={i} checked={mine.includes(i)} />
              {/if}
              {option}
              {#if mine.includes(i)}<span title="your vote"> ✓</span>{/if}
            </span>
            <span class="atm-poll__pct">{pct(counts[i])}% · {counts[i]}</span>
          </div>
          <div class="atm-poll__bar"><div class="atm-poll__fill" style="width: {pct(counts[i])}%"></div></div>
        </label>
      {/each}
    </div>
    <div class="atm-poll__foot">
      <span>
        {voters} {voters === 1 ? 'voter' : 'voters'}
        {#if syncing}· <span class="atm-spinner" aria-hidden="true"></span> saving your vote…{/if}
      </span>
      {#if open}
        <span>
          <button class="atm-btn atm-btn--primary atm-btn--sm" disabled={syncing}>{mine.length ? 'change vote' : 'vote'}</button>
          {#if mine.length}
            <button class="atm-btn atm-btn--ghost atm-btn--sm" formaction="?/retract" disabled={syncing}>retract</button>
          {/if}
        </span>
      {:else if !canVote && !closed}
        <a href="/login">Log in to vote</a>
      {/if}
    </div>
  </form>
</section>
