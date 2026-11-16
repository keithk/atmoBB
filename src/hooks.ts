import type { Reroute } from '@sveltejs/kit';

/** Keep the optional readable title segment in the public URL while routing by
 * the immutable AT Protocol identity at its tail. */
export const reroute: Reroute = ({ url }) => {
  const parts = url.pathname.split('/');
  if (parts[1] !== 't') return;

  // Accept the title-only shape and existing category/title links.
  const identity = parts[3]?.startsWith('did:') ? 3 : 4;
  const [did, rkey, suffix, replyDid, replyRkey] = parts.slice(identity);
  if (!did?.startsWith('did:') || !rkey) return;
  if (!suffix) return `/t/${did}/${rkey}`;
  if (suffix === 'og.png') return `/t/${did}/${rkey}/og.png`;
  if (suffix === 'p' && replyDid?.startsWith('did:') && replyRkey) {
    return `/t/${did}/${rkey}/p/${replyDid}/${replyRkey}`;
  }
};
