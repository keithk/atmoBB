import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/appview', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/server/appview')>(),
  getThreadPage: vi.fn(async () => ({
    thread: {
      uri: 'at://did:plc:alice/app.atmobb.discussion.thread/3kaaa',
      author: 'did:plc:alice',
      value: {
        board: 'at://did:plc:forum/app.atmobb.forum.board/3kboard',
        title: 'Cannot crop photo correctly',
        body: [],
      },
    },
    replies: [],
    replyCount: 0,
  })),
  getBoardThreads: vi.fn(async () => ({ board: { name: 'Bugs' }, threads: [] })),
}));

import { load } from './+page.server';

const canonicalPath = '/t/bugs/cannot-crop-photo-correctly/did:plc:alice/3kaaa';

function visit(path: string) {
  const url = new URL(path, 'https://forum.test');
  // SvelteKit forbids reading a fragment from event.url in a server load,
  // including requests with no fragment. A plain URL would hide this bug.
  Object.defineProperty(url, 'hash', {
    get() {
      throw new Error('Cannot access event.url.hash. Consider using `page.url.hash` inside a component instead');
    },
  });
  return load({
    params: { did: 'did:plc:alice', rkey: '3kaaa' },
    url,
    locals: { user: null },
    parent: async () => ({ staffRole: null, sidebarBoards: [] }),
    isDataRequest: false,
  } as never);
}

describe('thread canonical redirect', () => {
  it('redirects a newly indexed thread without reading the server URL fragment', async () => {
    await expect(visit('/t/did:plc:alice/3kaaa?fresh')).rejects.toMatchObject({
      status: 308,
      location: `${canonicalPath}?fresh`,
    });
  });

  it('preserves query state when redirecting stale board and title slugs', async () => {
    await expect(visit('/t/general/old-title/did:plc:alice/3kaaa?cursor=25&quote=3kbbb')).rejects.toMatchObject({
      status: 308,
      location: `${canonicalPath}?cursor=25&quote=3kbbb`,
    });
  });

  it('redirects a bare legacy link without appending a fragment or query', async () => {
    await expect(visit('/t/did:plc:alice/3kaaa')).rejects.toMatchObject({
      status: 308,
      location: canonicalPath,
    });
  });
});
