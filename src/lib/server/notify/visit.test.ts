import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleNotifyVisit, notifyVisitRedirect } from './visit';
import { bumpStats } from './store';

vi.mock('./store', () => ({ bumpStats: vi.fn(() => Promise.resolve()) }));

const user = { did: 'did:plc:alice', handle: 'alice.test' } as App.Locals['user'];

function visit(href: string, opts: { isDataRequest?: boolean; user?: App.Locals['user'] } = {}) {
  const setHeaders = vi.fn();
  const run = () =>
    handleNotifyVisit({
      url: new URL(href),
      isDataRequest: opts.isDataRequest ?? false,
      locals: { user: 'user' in opts ? opts.user ?? null : user },
      setHeaders,
    });
  return { run, setHeaders };
}

function thrownRedirect(run: () => void) {
  try {
    run();
  } catch (e) {
    if (isRedirect(e)) return e;
    throw e;
  }
  return null;
}

beforeEach(() => {
  vi.mocked(bumpStats).mockClear();
});

describe('notifyVisitRedirect', () => {
  it('strips via and keeps the other params and the fragment', () => {
    const target = notifyVisitRedirect(new URL('https://forum.test/t/did:plc:a/r?cursor=25&via=notify#post-x'), {
      isDataRequest: false,
      hasSession: true,
    });
    expect(target).toBe('/t/did:plc:a/r?cursor=25#post-x');
  });

  it('drops the query string entirely when via was the only param', () => {
    const target = notifyVisitRedirect(new URL('https://forum.test/t/did:plc:a/r?via=notify'), {
      isDataRequest: false,
      hasSession: true,
    });
    expect(target).toBe('/t/did:plc:a/r');
  });

  it('is null without the marker, for data requests, and without a session', () => {
    const marked = new URL('https://forum.test/t/did:plc:a/r?via=notify');
    expect(notifyVisitRedirect(new URL('https://forum.test/t/did:plc:a/r'), { isDataRequest: false, hasSession: true })).toBeNull();
    expect(notifyVisitRedirect(new URL('https://forum.test/t/did:plc:a/r?via=other'), { isDataRequest: false, hasSession: true })).toBeNull();
    expect(notifyVisitRedirect(marked, { isDataRequest: true, hasSession: true })).toBeNull();
    expect(notifyVisitRedirect(marked, { isDataRequest: false, hasSession: false })).toBeNull();
  });
});

describe('handleNotifyVisit', () => {
  it('counts and redirects a document load by a member with via=notify', () => {
    const { run, setHeaders } = visit('https://forum.test/t/did:plc:a/r?cursor=25&via=notify');
    const r = thrownRedirect(run);
    expect(r?.status).toBe(303);
    expect(r?.location).toBe('/t/did:plc:a/r?cursor=25');
    expect(bumpStats).toHaveBeenCalledWith('visited');
    expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
  });

  it('does nothing for a data request', () => {
    const { run, setHeaders } = visit('https://forum.test/t/did:plc:a/r?via=notify', { isDataRequest: true });
    expect(thrownRedirect(run)).toBeNull();
    expect(bumpStats).not.toHaveBeenCalled();
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it('does nothing without a session', () => {
    const { run } = visit('https://forum.test/t/did:plc:a/r?via=notify', { user: null });
    expect(thrownRedirect(run)).toBeNull();
    expect(bumpStats).not.toHaveBeenCalled();
  });

  it('still redirects when the counter write fails', () => {
    vi.mocked(bumpStats).mockRejectedValueOnce(new Error('disk full'));
    const { run } = visit('https://forum.test/t/did:plc:a/r?via=notify');
    expect(thrownRedirect(run)?.status).toBe(303);
  });
});
