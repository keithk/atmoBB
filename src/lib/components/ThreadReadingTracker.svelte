<script lang="ts">
  import { onMount } from 'svelte';
  import { markPostVisible, readingStateEvent } from '$lib/reading-state';

  let {
    accountDid,
    forumDid,
    threadUri,
  }: {
    accountDid?: string | null;
    forumDid: string;
    threadUri: string;
  } = $props();

  onMount(() => {
    if (!accountDid || !forumDid || typeof IntersectionObserver === 'undefined') return;
    let storage: Storage;
    try {
      storage = localStorage;
    } catch {
      return;
    }
    const scope = { accountDid, forumDid };
    const posts = document.querySelectorAll<HTMLElement>('[data-atm-post-position]');
    // Count posts that are genuinely on screen, not only posts that cross a
    // narrow reading band. Short threads can be read without any scrolling.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const post = entry.target as HTMLElement;
        const position = Number(post.dataset.atmPostPosition);
        const url = new URL(location.href);
        url.hash = post.id;
        // Reading-state destinations should not retain one-off composer/admin messages.
        for (const key of ['to', 'quote', 'edit', 'fresh', 'saved', 'deleted', 'moderated', 'pending']) {
          url.searchParams.delete(key);
        }
        const changed = markPostVisible(storage, scope, {
          threadUri,
          position,
          postHref: `${url.pathname}${url.search}${url.hash}`,
          postAt: post.dataset.atmPostAt || undefined,
        });
        if (changed) window.dispatchEvent(new Event(readingStateEvent(scope)));
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
    posts.forEach((post) => observer.observe(post));
    return () => observer.disconnect();
  });
</script>
