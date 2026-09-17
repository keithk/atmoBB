import type { Reroute } from '@sveltejs/kit';

/** Keep the readable board/title segments in the public URL while routing by
 * the immutable AT Protocol identity at its tail. */
export const reroute: Reroute = ({ url }) => {
  const parts = url.pathname.split('/');
  if (parts[1] !== 't' || parts.length < 6) return;

  const [, , , , did, rkey, suffix, replyDid, replyRkey] = parts;
  if (!did.startsWith('did:')) return;
  if (!suffix) return `/t/${did}/${rkey}`;
  if (suffix === 'og.png') return `/t/${did}/${rkey}/og.png`;
  if (suffix === 'p' && replyDid?.startsWith('did:') && replyRkey) {
    return `/t/${did}/${rkey}/p/${replyDid}/${replyRkey}`;
  }
};
